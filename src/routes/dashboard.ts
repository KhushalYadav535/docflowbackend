import express from 'express';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get dashboard stats
router.get('/stats', async (req: AuthRequest, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalDocs, todayDocs, pendingApprovals, storage] = await Promise.all([
      query(
        `SELECT COUNT(*) as count FROM documents WHERE tenant_id = $1`,
        [req.tenantId]
      ),
      query(
        `SELECT COUNT(*) as count FROM documents 
         WHERE tenant_id = $1 AND created_at >= $2`,
        [req.tenantId, today]
      ),
      query(
        `SELECT COUNT(*) as count FROM documents 
         WHERE tenant_id = $1 AND status = 'under_review'`,
        [req.tenantId]
      ),
      query(
        `SELECT COALESCE(SUM(file_size), 0) as total_size FROM document_versions dv
         INNER JOIN documents d ON dv.document_id = d.id
         WHERE d.tenant_id = $1`,
        [req.tenantId]
      ),
    ]);

    res.json({
      totalDocuments: parseInt(totalDocs.rows[0].count),
      uploadedToday: parseInt(todayDocs.rows[0].count),
      pendingApprovals: parseInt(pendingApprovals.rows[0].count),
      storageUsed: parseInt(storage.rows[0].total_size),
    });
  } catch (error: any) {
    next(error);
  }
});

// Get recent documents
router.get('/recent', async (req: AuthRequest, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;

    const result = await query(
      `SELECT d.*, u.name as uploader_name, f.name as folder_name
       FROM documents d
       LEFT JOIN users u ON d.created_by = u.id
       LEFT JOIN folders f ON d.folder_id = f.id
       WHERE d.tenant_id = $1
       ORDER BY d.updated_at DESC
       LIMIT $2`,
      [req.tenantId, limit]
    );

    res.json(result.rows);
  } catch (error: any) {
    next(error);
  }
});

// Get most accessed documents
router.get('/most-accessed', async (req: AuthRequest, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 5;

    const result = await query(
      `SELECT d.*, COUNT(al.id) as access_count, u.name as uploader_name
       FROM documents d
       INNER JOIN audit_logs al ON d.id = al.document_id
       LEFT JOIN users u ON d.created_by = u.id
       WHERE d.tenant_id = $1 AND al.action = 'DOCUMENT_VIEWED'
       GROUP BY d.id, u.name
       ORDER BY access_count DESC
       LIMIT $2`,
      [req.tenantId, limit]
    );

    res.json(result.rows);
  } catch (error: any) {
    next(error);
  }
});

// Get activity feed
router.get('/activity', async (req: AuthRequest, res, next) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;

    const result = await query(
      `SELECT al.*, u.name as user_name, d.name as document_name
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       LEFT JOIN documents d ON al.document_id = d.id
       WHERE al.tenant_id = $1
       ORDER BY al.timestamp DESC
       LIMIT $2`,
      [req.tenantId, limit]
    );

    res.json(result.rows);
  } catch (error: any) {
    next(error);
  }
});

export default router;
