import express from 'express';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = express.Router();

// Get user notifications
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const { limit = 50, unreadOnly } = req.query;

    let sql = `
      SELECT * FROM notifications
      WHERE user_id = $1 AND tenant_id = $2
    `;

    const params: any[] = [req.userId, req.tenantId];

    if (unreadOnly === 'true') {
      sql += ` AND is_read = false`;
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit as string));

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (error: any) {
    next(error);
  }
});

// Mark notification as read
router.patch('/:id/read', async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `UPDATE notifications 
       SET is_read = true 
       WHERE id = $1 AND user_id = $2 AND tenant_id = $3
       RETURNING *`,
      [id, req.userId, req.tenantId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Notification not found', 404);
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    next(error);
  }
});

// Mark all notifications as read
router.patch('/read-all', async (req: AuthRequest, res, next) => {
  try {
    await query(
      `UPDATE notifications 
       SET is_read = true 
       WHERE user_id = $1 AND tenant_id = $2 AND is_read = false`,
      [req.userId, req.tenantId]
    );

    res.json({ message: 'All notifications marked as read' });
  } catch (error: any) {
    next(error);
  }
});

// Get unread count
router.get('/unread-count', async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT COUNT(*) as count FROM notifications
       WHERE user_id = $1 AND tenant_id = $2 AND is_read = false`,
      [req.userId, req.tenantId]
    );

    res.json({ count: parseInt(result.rows[0].count) });
  } catch (error: any) {
    next(error);
  }
});

export default router;
