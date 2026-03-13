import express from 'express';
import { query } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = express.Router();

// Get tenant by ID
// Users can only access their own tenant
router.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    // Verify user is accessing their own tenant
    if (id !== req.tenantId) {
      throw new AppError('Access denied: You can only access your own tenant', 403);
    }

    const result = await query(
      `SELECT id, name, slug, logo_url as "logoUrl", created_at as "createdAt"
       FROM tenants
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new AppError('Tenant not found', 404);
    }

    const tenant = result.rows[0];
    
    // Return tenant data matching frontend Tenant interface
    res.json({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      logoUrl: tenant.logoUrl || null,
      createdAt: tenant.createdAt,
    });
  } catch (error: any) {
    next(error);
  }
});

export default router;
