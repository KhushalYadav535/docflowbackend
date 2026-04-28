import express from 'express';
import { upload, calculateChecksum } from '../utils/fileUpload';
import { query, transaction } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { createAuditLog, AuditActions } from '../services/audit';
import { extractTextWithRetry } from '../services/ocr';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';
import { sendEmailNotification, emailTemplates } from '../services/emailService';

const router = express.Router();

// Upload document
router.post('/upload', upload.single('file'), async (req: AuthRequest, res, next) => {
  try {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const { metadata } = req.body;
    const metadataObj = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;

    if (!metadataObj.name) {
      throw new AppError('Document name is required', 400);
    }

    const filePath = req.file.path;
    const checksum = await calculateChecksum(filePath);

    // Check for duplicate
    const duplicateCheck = await query(
      `SELECT dv.id, d.id as document_id FROM document_versions dv
       INNER JOIN documents d ON dv.document_id = d.id
       WHERE dv.checksum = $1 AND d.tenant_id = $2`,
      [checksum, req.tenantId]
    );

    let documentId: string;
    let isDuplicate = false;

    if (duplicateCheck.rows.length > 0) {
      isDuplicate = true;
      // Return existing document info
      documentId = duplicateCheck.rows[0].document_id;
    } else {
      // Create new document
      const result = await transaction(async (client) => {
        // Generate document number
        const year = new Date().getFullYear();
        const docNumberResult = await client.query(
          `SELECT COUNT(*) as count FROM documents 
           WHERE tenant_id = $1 AND EXTRACT(YEAR FROM created_at) = $2`,
          [req.tenantId, year]
        );
        const sequence = parseInt(docNumberResult.rows[0].count) + 1;
        const docNumber = `DOC-${year}-${sequence.toString().padStart(4, '0')}`;

        // Create document
        const docResult = await client.query(
          `INSERT INTO documents (tenant_id, doc_number, name, folder_id, status, created_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [
            req.tenantId,
            docNumber,
            metadataObj.name,
            metadataObj.folderId || null,
            'draft',
            req.userId,
          ]
        );

        const docId = docResult.rows[0].id;

        // Create version
        const versionResult = await client.query(
          `INSERT INTO document_versions 
           (document_id, version_number, file_path, file_size, file_type, checksum, uploaded_by, change_note)
           VALUES ($1, 1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            docId,
            filePath,
            req.file!.size,
            req.file!.mimetype,
            checksum,
            req.userId,
            metadataObj.changeNote || 'Initial upload',
          ]
        );

        // Update document current_version_id
        await client.query(
          `UPDATE documents SET current_version_id = $1 WHERE id = $2`,
          [versionResult.rows[0].id, docId]
        );

        // Insert metadata values
        if (metadataObj.metadata) {
          for (const [fieldName, value] of Object.entries(metadataObj.metadata)) {
            const fieldResult = await client.query(
              `SELECT id FROM metadata_fields WHERE tenant_id = $1 AND name = $2`,
              [req.tenantId, fieldName]
            );
            if (fieldResult.rows.length > 0) {
              await client.query(
                `INSERT INTO metadata_values (document_id, field_id, value, updated_by)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (document_id, field_id) DO UPDATE SET value = $3, updated_by = $4`,
                [docId, fieldResult.rows[0].id, String(value), req.userId]
              );
            }
          }
        }

        return { documentId: docId, versionId: versionResult.rows[0].id };
      });

      documentId = result.documentId;

      // Trigger OCR asynchronously
      setImmediate(async () => {
        try {
          await query(
            `UPDATE document_versions SET ocr_status = 'processing' WHERE id = $1`,
            [result.versionId]
          );

          const ocrResult = await extractTextWithRetry(filePath);

          await transaction(async (client) => {
            // Update version with OCR text
            await client.query(
              `UPDATE document_versions SET ocr_text = $1, ocr_status = 'completed' WHERE id = $2`,
              [ocrResult.text, result.versionId]
            );

            // Insert into search index
            await client.query(
              `INSERT INTO search_index (document_id, version_id, extracted_text)
               VALUES ($1, $2, $3)
               ON CONFLICT (document_id, version_id) DO UPDATE SET extracted_text = $3`,
              [result.documentId, result.versionId, ocrResult.text]
            );

            // Update document status
            await client.query(
              `UPDATE documents SET status = 'indexed' WHERE id = $1`,
              [result.documentId]
            );
          });

          await createAuditLog({
            tenantId: req.tenantId!,
            userId: req.userId!,
            action: AuditActions.OCR_COMPLETED,
            documentId: result.documentId,
          });
        } catch (error: any) {
          logger.error('OCR processing failed', { error, documentId: result.documentId });
          await query(
            `UPDATE document_versions SET ocr_status = 'failed' WHERE id = $1`,
            [result.versionId]
          );
          await query(`UPDATE documents SET status = 'ocr_failed' WHERE id = $1`, [
            result.documentId,
          ]);

          await createAuditLog({
            tenantId: req.tenantId!,
            userId: req.userId!,
            action: AuditActions.OCR_FAILED,
            documentId: result.documentId,
          });
        }
      });

      await createAuditLog({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: AuditActions.DOCUMENT_UPLOADED,
        documentId,
        ipAddress: req.ip,
      });

      // Send email notification (optional - can be configured per user)
      try {
        const userResult = await query(
          `SELECT email, name FROM users WHERE id = $1 AND tenant_id = $2`,
          [req.userId, req.tenantId]
        );
        
        if (userResult.rows.length > 0) {
          const user = userResult.rows[0];
          const documentUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/documents/${documentId}`;
          const emailTemplate = emailTemplates.documentUploaded(user.name, req.body.name || 'Document', documentUrl);
          await sendEmailNotification(user.email, emailTemplate.subject, emailTemplate.html);
        }
      } catch (emailError: any) {
        logger.warn('Failed to send upload notification email', { error: emailError.message });
        // Don't fail the upload if email fails
      }
    }

    res.json({
      documentId,
      checksum,
      duplicate: isDuplicate,
      message: isDuplicate ? 'Duplicate file detected' : 'Document uploaded successfully',
    });
  } catch (error: any) {
    next(error);
  }
});

// List all documents for the tenant
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const { folderId, page = '1', limit = '50' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    let queryText = `
      SELECT d.id, d.name, d.status, d.doc_number,
             d.created_at, d.updated_at, d.folder_id,
             u.name as uploaded_by,
             f.name as folder_name,
             dv.file_size, dv.file_type, dv.version_number, dv.uploaded_at
      FROM documents d
      LEFT JOIN users u ON d.created_by = u.id
      LEFT JOIN folders f ON d.folder_id = f.id
      LEFT JOIN document_versions dv ON d.current_version_id = dv.id
      WHERE d.tenant_id = $1
    `;
    const params: any[] = [req.tenantId];
    let paramIdx = 2;

    if (folderId) {
      queryText += ` AND d.folder_id = $${paramIdx}`;
      params.push(folderId);
      paramIdx++;
    }

    queryText += ` ORDER BY d.created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    params.push(limitNum, offset);

    const result = await query(queryText, params);
    
    // Optionally fetch metadata for each document (department, document_type, etc.)
    // For now, return basic document info
    res.json(result.rows);
  } catch (error: any) {
    logger.error('Error fetching documents list', { error: error.message, stack: error.stack });
    next(error);
  }
});

// Search documents (MUST be before /:id to avoid matching 'search' as an id)
router.get('/search', async (req: AuthRequest, res, next) => {
  try {
    let { q, dateFrom, dateTo, documentType, department, uploadedBy, folderId, status, naturalLanguage } = req.query;

    // Process natural language query if enabled
    if (naturalLanguage === 'true' && q && typeof q === 'string') {
      const { parseNaturalLanguageQuery, convertToSearchFilters } = await import('../services/naturalLanguageQuery');
      const parsed = parseNaturalLanguageQuery(q);
      const filters = convertToSearchFilters(parsed);
      
      q = filters.keyword || q;
      if (filters.dateFrom && !dateFrom) dateFrom = filters.dateFrom;
      if (filters.dateTo && !dateTo) dateTo = filters.dateTo;
      if (filters.documentType && !documentType) documentType = filters.documentType;
      if (filters.department && !department) department = filters.department;
      if (filters.uploadedBy && !uploadedBy) uploadedBy = filters.uploadedBy;
    }

    let sql = `
      SELECT DISTINCT d.*, 
             u.name as uploader_name,
             f.name as folder_name,
             dv.version_number,
             ts_rank(to_tsvector('english', COALESCE(si.extracted_text, '')), 
                     plainto_tsquery('english', $1)) as relevance
      FROM documents d
      LEFT JOIN users u ON d.created_by = u.id
      LEFT JOIN folders f ON d.folder_id = f.id
      LEFT JOIN document_versions dv ON d.current_version_id = dv.id
      LEFT JOIN search_index si ON d.id = si.document_id AND dv.id = si.version_id
      WHERE d.tenant_id = $2
    `;

    const params: any[] = [q || '', req.tenantId];
    let paramIndex = 3;

    if (q) {
      sql += ` AND (
        d.name ILIKE $${paramIndex} OR
        si.extracted_text ILIKE $${paramIndex} OR
        to_tsvector('english', COALESCE(si.extracted_text, '')) @@ plainto_tsquery('english', $1)
      )`;
      params.push(`%${q}%`);
      paramIndex++;
    }

    if (dateFrom) {
      sql += ` AND d.created_at >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }

    if (dateTo) {
      sql += ` AND d.created_at <= $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }

    if (status) {
      sql += ` AND d.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (folderId) {
      sql += ` AND d.folder_id = $${paramIndex}`;
      params.push(folderId);
      paramIndex++;
    }

    sql += ` ORDER BY relevance DESC, d.created_at DESC LIMIT 50`;

    const result = await query(sql, params);

    res.json({
      results: result.rows,
      count: result.rows.length,
    });
  } catch (error: any) {
    next(error);
  }
});

// Get document
router.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT d.*, 
              u.name as uploader_name,
              f.name as folder_name,
              dv.file_path, dv.version_number, dv.uploaded_at, dv.ocr_status, dv.ocr_text
       FROM documents d
       LEFT JOIN users u ON d.created_by = u.id
       LEFT JOIN folders f ON d.folder_id = f.id
       LEFT JOIN document_versions dv ON d.current_version_id = dv.id
       WHERE d.id = $1 AND d.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Document not found', 404);
    }

    const doc = result.rows[0];

    // Get metadata values
    const metadataResult = await query(
      `SELECT mf.name, mv.value 
       FROM metadata_values mv
       INNER JOIN metadata_fields mf ON mv.field_id = mf.id
       WHERE mv.document_id = $1`,
      [req.params.id]
    );

    doc.metadata = metadataResult.rows.reduce((acc: any, row: any) => {
      acc[row.name] = row.value;
      return acc;
    }, {});

    await createAuditLog({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: AuditActions.DOCUMENT_VIEWED,
      documentId: req.params.id,
      ipAddress: req.ip,
    });

    res.json(doc);
  } catch (error: any) {
    next(error);
  }
});

// Get document file
router.get('/:id/file', async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT dv.file_path, d.name 
       FROM documents d
       INNER JOIN document_versions dv ON d.current_version_id = dv.id
       WHERE d.id = $1 AND d.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Document not found', 404);
    }

    const filePath = result.rows[0].file_path;
    const resolvedPath = path.resolve(filePath);
    
    if (!fs.existsSync(resolvedPath)) {
      logger.error('File not found at path', { filePath, resolvedPath });
      throw new AppError('File not found', 404);
    }

    await createAuditLog({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: AuditActions.DOCUMENT_DOWNLOADED,
      documentId: req.params.id,
      ipAddress: req.ip,
    });

    res.sendFile(resolvedPath);
  } catch (error: any) {
    next(error);
  }
});

// Move document
router.patch('/:id/move', async (req: AuthRequest, res, next) => {
  try {
    const { folderId } = req.body;

    const result = await query(
      `UPDATE documents SET folder_id = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING id`,
      [folderId || null, req.params.id, req.tenantId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Document not found', 404);
    }

    await createAuditLog({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: AuditActions.DOCUMENT_MOVED,
      documentId: req.params.id,
      metadataSnapshot: { folderId },
    });

    res.json({ success: true, message: 'Document moved successfully' });
  } catch (error: any) {
    next(error);
  }
});

// Get document versions
router.get('/:id/versions', async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT dv.*, u.name as uploader_name
       FROM document_versions dv
       INNER JOIN documents d ON dv.document_id = d.id
       LEFT JOIN users u ON dv.uploaded_by = u.id
       WHERE d.id = $1 AND d.tenant_id = $2
       ORDER BY dv.version_number DESC`,
      [req.params.id, req.tenantId]
    );

    res.json(result.rows);
  } catch (error: any) {
    next(error);
  }
});

// Upload new version
router.post('/:id/versions', upload.single('file'), async (req: AuthRequest, res, next) => {
  try {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const { changeNote } = req.body;

    const result = await transaction(async (client) => {
      // Get current max version
      const versionResult = await client.query(
        `SELECT MAX(version_number) as max_version FROM document_versions
         WHERE document_id = $1`,
        [req.params.id]
      );

      const nextVersion = (versionResult.rows[0].max_version || 0) + 1;
      const filePath = req.file!.path;
      const checksum = await calculateChecksum(filePath);

      // Create new version
      const versionInsert = await client.query(
        `INSERT INTO document_versions 
         (document_id, version_number, file_path, file_size, file_type, checksum, uploaded_by, change_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          req.params.id,
          nextVersion,
          filePath,
          req.file!.size,
          req.file!.mimetype,
          checksum,
          req.userId,
          changeNote || `Version ${nextVersion}`,
        ]
      );

      // Update document current_version_id
      await client.query(
        `UPDATE documents SET current_version_id = $1, updated_at = NOW() WHERE id = $2`,
        [versionInsert.rows[0].id, req.params.id]
      );

      return versionInsert.rows[0].id;
    });

    // Trigger OCR
    setImmediate(async () => {
      try {
        await query(
          `UPDATE document_versions SET ocr_status = 'processing' WHERE id = $1`,
          [result]
        );

        const ocrResult = await extractTextWithRetry(req.file!.path);

        await transaction(async (client) => {
          await client.query(
            `UPDATE document_versions SET ocr_text = $1, ocr_status = 'completed' WHERE id = $2`,
            [ocrResult.text, result]
          );

          await client.query(
            `INSERT INTO search_index (document_id, version_id, extracted_text)
             VALUES ($1, $2, $3)
             ON CONFLICT (document_id, version_id) DO UPDATE SET extracted_text = $3`,
            [req.params.id, result, ocrResult.text]
          );
        });
      } catch (error: any) {
        logger.error('OCR failed for version', { error, versionId: result });
        await query(
          `UPDATE document_versions SET ocr_status = 'failed' WHERE id = $1`,
          [result]
        );
      }
    });

    await createAuditLog({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: AuditActions.VERSION_UPLOADED,
      documentId: req.params.id,
    });

    res.json({ success: true, versionId: result });
  } catch (error: any) {
    next(error);
  }
});

// Restore version
router.post('/:id/versions/:versionId/restore', async (req: AuthRequest, res, next) => {
  try {
    await transaction(async (client) => {
      // Get version to restore
      const versionResult = await client.query(
        `SELECT dv.* FROM document_versions dv
         INNER JOIN documents d ON dv.document_id = d.id
         WHERE dv.id = $1 AND d.tenant_id = $2`,
        [req.params.versionId, req.tenantId]
      );

      if (versionResult.rows.length === 0) {
        throw new AppError('Version not found', 404);
      }

      const version = versionResult.rows[0];

      // Get max version number
      const maxVersionResult = await client.query(
        `SELECT MAX(version_number) as max_version FROM document_versions
         WHERE document_id = $1`,
        [req.params.id]
      );

      const nextVersion = (maxVersionResult.rows[0].max_version || 0) + 1;

      // Create new version entry (restore creates new version)
      const restoreResult = await client.query(
        `INSERT INTO document_versions 
         (document_id, version_number, file_path, file_size, file_type, checksum, uploaded_by, change_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          req.params.id,
          nextVersion,
          version.file_path,
          version.file_size,
          version.file_type,
          version.checksum,
          req.userId,
          `Restored from version ${version.version_number}`,
        ]
      );

      // Update document current_version_id
      await client.query(
        `UPDATE documents SET current_version_id = $1, updated_at = NOW() WHERE id = $2`,
        [restoreResult.rows[0].id, req.params.id]
      );
    });

    await createAuditLog({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: AuditActions.VERSION_RESTORED,
      documentId: req.params.id,
    });

    res.json({ success: true, message: 'Version restored successfully' });
  } catch (error: any) {
    next(error);
  }
});

// Trigger OCR manually
router.post('/:id/ocr/trigger', async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT dv.id as version_id, dv.file_path, d.id as document_id
       FROM documents d
       INNER JOIN document_versions dv ON d.current_version_id = dv.id
       WHERE d.id = $1 AND d.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Document not found', 404);
    }

    const { version_id, file_path, document_id } = result.rows[0];

    // Update status to processing
    await query(
      `UPDATE document_versions SET ocr_status = 'processing' WHERE id = $1`,
      [version_id]
    );

    // Trigger OCR asynchronously
    setImmediate(async () => {
      try {
        const ocrResult = await extractTextWithRetry(file_path);

        await transaction(async (client) => {
          await client.query(
            `UPDATE document_versions SET ocr_text = $1, ocr_status = 'completed' WHERE id = $2`,
            [ocrResult.text, version_id]
          );

          await client.query(
            `INSERT INTO search_index (document_id, version_id, extracted_text)
             VALUES ($1, $2, $3)
             ON CONFLICT (document_id, version_id) DO UPDATE SET extracted_text = $3`,
            [document_id, version_id, ocrResult.text]
          );

          await client.query(`UPDATE documents SET status = 'indexed' WHERE id = $1`, [
            document_id,
          ]);
        });

        await createAuditLog({
          tenantId: req.tenantId!,
          userId: req.userId!,
          action: AuditActions.OCR_COMPLETED,
          documentId: document_id,
        });
      } catch (error: any) {
        logger.error('Manual OCR failed', { error, document_id });
        await query(
          `UPDATE document_versions SET ocr_status = 'failed' WHERE id = $1`,
          [version_id]
        );
        await query(`UPDATE documents SET status = 'ocr_failed' WHERE id = $1`, [document_id]);

        await createAuditLog({
          tenantId: req.tenantId!,
          userId: req.userId!,
          action: AuditActions.OCR_FAILED,
          documentId: document_id,
        });
      }
    });

    await createAuditLog({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: AuditActions.OCR_TRIGGERED,
      documentId: req.params.id,
    });

    res.json({ success: true, message: 'OCR processing started' });
  } catch (error: any) {
    next(error);
  }
});

// Get OCR status
router.get('/:id/ocr/status', async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT dv.ocr_status, dv.ocr_text, d.status
       FROM documents d
       INNER JOIN document_versions dv ON d.current_version_id = dv.id
       WHERE d.id = $1 AND d.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Document not found', 404);
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    next(error);
  }
});

export default router;
