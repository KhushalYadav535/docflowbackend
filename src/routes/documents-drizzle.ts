/**
 * Documents Route using Drizzle ORM
 * Example implementation - replace documents.ts with this
 */

import express from 'express';
import { upload, calculateChecksum } from '../utils/fileUpload';
import { db } from '../database/db';
import { documents, documentVersions, metadataValues, metadataFields, searchIndex } from '../database/schema';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { createAuditLogEntry, AuditActions } from '../services/audit';
import { extractTextWithRetry } from '../services/ocr';
import { eq, and, desc } from 'drizzle-orm';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';
import {
  findDocumentWithMetadata,
  checkDuplicateChecksum,
  generateDocumentNumber,
  searchDocuments,
} from '../database/helpers';

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

    // Check for duplicate using Drizzle
    const duplicate = await checkDuplicateChecksum(checksum, req.tenantId!);

    let documentId: string;
    let isDuplicate = false;

    if (duplicate) {
      isDuplicate = true;
      documentId = duplicate.documentId;
    } else {
      // Generate document number
      const docNumber = await generateDocumentNumber(req.tenantId!);

      // Create document and version in transaction
      const result = await db.transaction(async (tx) => {
        // Create document
        const [newDoc] = await tx
          .insert(documents)
          .values({
            tenantId: req.tenantId!,
            docNumber,
            name: metadataObj.name,
            folderId: metadataObj.folderId || null,
            status: 'draft',
            createdBy: req.userId!,
          })
          .returning();

        // Create version
        const [newVersion] = await tx
          .insert(documentVersions)
          .values({
            documentId: newDoc.id,
            versionNumber: 1,
            filePath,
            fileSize: req.file!.size,
            fileType: req.file!.mimetype,
            checksum,
            uploadedBy: req.userId!,
            changeNote: metadataObj.changeNote || 'Initial upload',
            ocrStatus: 'processing',
          })
          .returning();

        // Update document current_version_id
        await tx
          .update(documents)
          .set({ currentVersionId: newVersion.id })
          .where(eq(documents.id, newDoc.id));

        // Insert metadata values
        if (metadataObj.metadata) {
          for (const [fieldName, value] of Object.entries(metadataObj.metadata)) {
            const field = await tx.query.metadataFields.findFirst({
              where: and(
                eq(metadataFields.tenantId, req.tenantId!),
                eq(metadataFields.name, fieldName)
              ),
            });

            if (field) {
              await tx
                .insert(metadataValues)
                .values({
                  documentId: newDoc.id,
                  fieldId: field.id,
                  value: String(value),
                  updatedBy: req.userId!,
                })
                .onConflictDoUpdate({
                  target: [metadataValues.documentId, metadataValues.fieldId],
                  set: {
                    value: String(value),
                    updatedBy: req.userId!,
                    updatedAt: new Date(),
                  },
                });
            }
          }
        }

        return { documentId: newDoc.id, versionId: newVersion.id };
      });

      documentId = result.documentId;

      // Trigger OCR asynchronously
      setImmediate(async () => {
        try {
          await db
            .update(documentVersions)
            .set({ ocrStatus: 'processing' })
            .where(eq(documentVersions.id, result.versionId));

          const ocrResult = await extractTextWithRetry(filePath);

          await db.transaction(async (tx) => {
            // Update version with OCR text
            await tx
              .update(documentVersions)
              .set({
                ocrText: ocrResult.text,
                ocrStatus: 'completed',
              })
              .where(eq(documentVersions.id, result.versionId));

            // Insert into search index
            await tx
              .insert(searchIndex)
              .values({
                documentId: result.documentId,
                versionId: result.versionId,
                extractedText: ocrResult.text,
              })
              .onConflictDoUpdate({
                target: [searchIndex.documentId, searchIndex.versionId],
                set: {
                  extractedText: ocrResult.text,
                },
              });

            // Update document status
            await tx
              .update(documents)
              .set({ status: 'indexed' })
              .where(eq(documents.id, result.documentId));
          });

          await createAuditLogEntry({
            tenantId: req.tenantId!,
            userId: req.userId!,
            action: AuditActions.OCR_COMPLETED,
            documentId: result.documentId,
          });
        } catch (error: any) {
          logger.error('OCR processing failed', { error, documentId: result.documentId });
          await db
            .update(documentVersions)
            .set({ ocrStatus: 'failed' })
            .where(eq(documentVersions.id, result.versionId));
          await db
            .update(documents)
            .set({ status: 'ocr_failed' })
            .where(eq(documents.id, result.documentId));

          await createAuditLogEntry({
            tenantId: req.tenantId!,
            userId: req.userId!,
            action: AuditActions.OCR_FAILED,
            documentId: result.documentId,
          });
        }
      });

      await createAuditLogEntry({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: AuditActions.DOCUMENT_UPLOADED,
        documentId,
        ipAddress: req.ip,
      });
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

// Get document
router.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const doc = await findDocumentWithMetadata(req.params.id, req.tenantId!);

    if (!doc) {
      throw new AppError('Document not found', 404);
    }

    await createAuditLogEntry({
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

// Search documents
router.get('/search', async (req: AuthRequest, res, next) => {
  try {
    const { q, dateFrom, dateTo, documentType, department, uploadedBy, folderId, status } =
      req.query;

    const results = await searchDocuments(
      q as string,
      req.tenantId!,
      {
        dateFrom: dateFrom as string,
        dateTo: dateTo as string,
        documentType: documentType as string,
        department: department as string,
        uploadedBy: uploadedBy as string,
        folderId: folderId as string,
        status: status as string,
      }
    );

    res.json({
      results,
      count: results.length,
    });
  } catch (error: any) {
    next(error);
  }
});

// Move document
router.patch('/:id/move', async (req: AuthRequest, res, next) => {
  try {
    const { folderId } = req.body;

    const [updated] = await db
      .update(documents)
      .set({
        folderId: folderId || null,
        updatedAt: new Date(),
      })
      .where(and(eq(documents.id, req.params.id), eq(documents.tenantId, req.tenantId!)))
      .returning();

    if (!updated) {
      throw new AppError('Document not found', 404);
    }

    await createAuditLogEntry({
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
    const versions = await db.query.documentVersions.findMany({
      where: eq(documentVersions.documentId, req.params.id),
      with: {
        uploader: {
          columns: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [desc(documentVersions.versionNumber)],
    });

    // Verify document belongs to tenant
    const doc = await db.query.documents.findFirst({
      where: and(eq(documents.id, req.params.id), eq(documents.tenantId, req.tenantId!)),
    });

    if (!doc) {
      throw new AppError('Document not found', 404);
    }

    res.json(versions);
  } catch (error: any) {
    next(error);
  }
});

export default router;
