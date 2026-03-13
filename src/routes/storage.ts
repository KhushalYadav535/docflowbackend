import express from 'express';
import { query } from '../database/connection';
import { AuthRequest, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// Get storage statistics (Admin only)
router.get('/stats', requireRole('Admin'), async (req: AuthRequest, res, next) => {
  try {
    // Get total storage used
    const storageResult = await query(
      `SELECT COALESCE(SUM(file_size), 0) as total_size,
              COUNT(*) as total_files
       FROM document_versions dv
       INNER JOIN documents d ON dv.document_id = d.id
       WHERE d.tenant_id = $1`,
      [req.tenantId]
    );

    // Get storage by file type
    const typeResult = await query(
      `SELECT file_type, 
              COUNT(*) as count,
              COALESCE(SUM(file_size), 0) as size
       FROM document_versions dv
       INNER JOIN documents d ON dv.document_id = d.id
       WHERE d.tenant_id = $1
       GROUP BY file_type
       ORDER BY size DESC`,
      [req.tenantId]
    );

    // Get storage by folder
    const folderResult = await query(
      `SELECT f.name as folder_name,
              COUNT(DISTINCT d.id) as document_count,
              COALESCE(SUM(dv.file_size), 0) as size
       FROM documents d
       LEFT JOIN folders f ON d.folder_id = f.id
       LEFT JOIN document_versions dv ON d.current_version_id = dv.id
       WHERE d.tenant_id = $1
       GROUP BY f.id, f.name
       ORDER BY size DESC
       LIMIT 10`,
      [req.tenantId]
    );

    // Get largest documents
    const largestResult = await query(
      `SELECT d.name, dv.file_size, dv.file_type
       FROM documents d
       INNER JOIN document_versions dv ON d.current_version_id = dv.id
       WHERE d.tenant_id = $1
       ORDER BY dv.file_size DESC
       LIMIT 10`,
      [req.tenantId]
    );

    res.json({
      totalSize: parseInt(storageResult.rows[0].total_size) || 0,
      totalFiles: parseInt(storageResult.rows[0].total_files) || 0,
      byType: typeResult.rows,
      byFolder: folderResult.rows,
      largestDocuments: largestResult.rows,
    });
  } catch (error: any) {
    next(error);
  }
});

// Clean up orphaned files (Admin only)
router.post('/cleanup', requireRole('Admin'), async (req: AuthRequest, res, next) => {
  try {
    // Get all file paths from database
    const dbFilesResult = await query(
      `SELECT DISTINCT file_path FROM document_versions dv
       INNER JOIN documents d ON dv.document_id = d.id
       WHERE d.tenant_id = $1`,
      [req.tenantId]
    );

    const dbFilePaths = new Set(dbFilesResult.rows.map((r: any) => r.file_path));

    // Get upload directory
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const tenantUploadDir = path.join(uploadDir, req.tenantId!);

    let orphanedCount = 0;
    let orphanedSize = 0;

    if (fs.existsSync(tenantUploadDir)) {
      const files = fs.readdirSync(tenantUploadDir, { recursive: true });
      
      for (const file of files) {
        const filePath = path.join(tenantUploadDir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isFile()) {
          const relativePath = path.relative(uploadDir, filePath);
          if (!dbFilePaths.has(relativePath)) {
            orphanedSize += stat.size;
            fs.unlinkSync(filePath);
            orphanedCount++;
          }
        }
      }
    }

    res.json({
      message: 'Cleanup completed',
      orphanedFiles: orphanedCount,
      freedSpace: orphanedSize,
    });
  } catch (error: any) {
    next(error);
  }
});

export default router;
