import express from 'express';
import { query } from '../database/connection';
import { AuthRequest, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = express.Router();

// Get audit logs (Admin/Manager only)
router.get('/audit-logs', requireRole('Admin', 'Manager'), async (req: AuthRequest, res, next) => {
  try {
    const { dateFrom, dateTo, userId, action, documentId } = req.query;

    let sql = `
      SELECT al.*, u.name as user_name, d.name as document_name
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      LEFT JOIN documents d ON al.document_id = d.id
      WHERE al.tenant_id = $1
    `;

    const params: any[] = [req.tenantId];
    let paramIndex = 2;

    if (dateFrom) {
      sql += ` AND al.timestamp >= $${paramIndex++}`;
      params.push(dateFrom);
    }

    if (dateTo) {
      sql += ` AND al.timestamp <= $${paramIndex++}`;
      params.push(dateTo);
    }

    if (userId) {
      sql += ` AND al.user_id = $${paramIndex++}`;
      params.push(userId);
    }

    if (action) {
      sql += ` AND al.action = $${paramIndex++}`;
      params.push(action);
    }

    if (documentId) {
      sql += ` AND al.document_id = $${paramIndex++}`;
      params.push(documentId);
    }

    sql += ` ORDER BY al.timestamp DESC LIMIT 500`;

    const result = await query(sql, params);

    res.json(result.rows);
  } catch (error: any) {
    next(error);
  }
});

// Get roles (Admin only)
router.get('/roles', requireRole('Admin'), async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT r.*, 
              COUNT(DISTINCT ur.user_id) as user_count,
              ARRAY_AGG(p.action || ':' || p.resource) as permissions
       FROM roles r
       LEFT JOIN user_roles ur ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON r.id = rp.role_id
       LEFT JOIN permissions p ON rp.permission_id = p.id
       WHERE r.tenant_id = $1
       GROUP BY r.id
       ORDER BY r.name`,
      [req.tenantId]
    );

    res.json(result.rows.map((row) => ({
      ...row,
      permissions: row.permissions.filter((p: string) => p !== null),
    })));
  } catch (error: any) {
    next(error);
  }
});

export default router;
