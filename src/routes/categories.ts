import express from 'express';
import { query, transaction } from '../database/connection';
import { AuthRequest, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { createAuditLog, AuditActions } from '../services/audit';

const router = express.Router();

// Get all categories (Admin/Manager)
router.get('/', requireRole('Admin', 'Manager'), async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT dc.*, 
              COUNT(DISTINCT d.id) as document_count
       FROM document_categories dc
       LEFT JOIN documents d ON d.tenant_id = dc.tenant_id 
         AND EXISTS (
           SELECT 1 FROM metadata_values mv 
           JOIN metadata_fields mf ON mv.field_id = mf.id
           WHERE mv.document_id = d.id 
           AND mf.name = 'Category' 
           AND mv.value = dc.name
         )
       WHERE dc.tenant_id = $1
       GROUP BY dc.id
       ORDER BY dc.name`,
      [req.tenantId]
    );
    res.json(result.rows);
  } catch (error: any) {
    next(error);
  }
});

// Create category (Admin/Manager)
router.post('/', requireRole('Admin', 'Manager'), async (req: AuthRequest, res, next) => {
  try {
    const { name, description, status } = req.body;

    if (!name) {
      throw new AppError('Category name is required', 400);
    }

    const result = await transaction(async (client) => {
      // Check if category already exists
      const existing = await client.query(
        `SELECT id FROM document_categories WHERE tenant_id = $1 AND name = $2`,
        [req.tenantId, name]
      );

      if (existing.rows.length > 0) {
        throw new AppError('Category with this name already exists', 400);
      }

      const categoryResult = await client.query(
        `INSERT INTO document_categories (tenant_id, name, description, status)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.tenantId, name, description || null, status || 'active']
      );

      await createAuditLog({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: AuditActions.CATEGORY_CREATED,
        documentId: null,
        ipAddress: req.ip,
        metadataSnapshot: { categoryName: name },
      });

      return categoryResult.rows[0];
    });

    res.status(201).json(result);
  } catch (error: any) {
    next(error);
  }
});

// Update category (Admin/Manager)
router.put('/:id', requireRole('Admin', 'Manager'), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, status } = req.body;

    const result = await query(
      `UPDATE document_categories 
       SET name = $1, description = $2, status = $3
       WHERE id = $4 AND tenant_id = $5
       RETURNING *`,
      [name, description, status, id, req.tenantId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Category not found', 404);
    }

    await createAuditLog({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: AuditActions.CATEGORY_UPDATED,
      documentId: null,
      ipAddress: req.ip,
      metadataSnapshot: { categoryId: id, categoryName: name },
    });

    res.json(result.rows[0]);
  } catch (error: any) {
    next(error);
  }
});

// Delete category (Admin/Manager)
router.delete('/:id', requireRole('Admin', 'Manager'), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    // Check if category is used in any documents
    const usageCheck = await query(
      `SELECT COUNT(*) as count FROM metadata_values mv
       JOIN metadata_fields mf ON mv.field_id = mf.id
       JOIN document_categories dc ON mv.value = dc.name
       WHERE dc.id = $1 AND mf.name = 'Category'`,
      [id]
    );

    if (parseInt(usageCheck.rows[0].count) > 0) {
      throw new AppError('Cannot delete category that is in use', 400);
    }

    const result = await query(
      `DELETE FROM document_categories WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, req.tenantId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Category not found', 404);
    }

    await createAuditLog({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: AuditActions.CATEGORY_DELETED,
      documentId: null,
      ipAddress: req.ip,
      metadataSnapshot: { categoryId: id },
    });

    res.json({ message: 'Category deleted successfully' });
  } catch (error: any) {
    next(error);
  }
});

export default router;
