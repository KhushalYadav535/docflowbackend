import express from 'express';
import { query, transaction } from '../database/connection';
import { AuthRequest, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { createAuditLog, AuditActions } from '../services/audit';

const router = express.Router();

// Get all metadata fields (Admin only)
router.get('/', requireRole('Admin'), async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT mf.*, u.name as created_by_name
       FROM metadata_fields mf
       LEFT JOIN users u ON mf.created_by = u.id
       WHERE mf.tenant_id = $1
       ORDER BY mf.name`,
      [req.tenantId]
    );
    res.json(result.rows);
  } catch (error: any) {
    next(error);
  }
});

// Create metadata field (Admin only)
router.post('/', requireRole('Admin'), async (req: AuthRequest, res, next) => {
  try {
    const { name, fieldType, isRequired, category } = req.body;

    if (!name || !fieldType) {
      throw new AppError('Name and field type are required', 400);
    }

    const result = await transaction(async (client) => {
      // Check if field already exists
      const existing = await client.query(
        `SELECT id FROM metadata_fields WHERE tenant_id = $1 AND name = $2`,
        [req.tenantId, name]
      );

      if (existing.rows.length > 0) {
        throw new AppError('Metadata field with this name already exists', 400);
      }

      const fieldResult = await client.query(
        `INSERT INTO metadata_fields (tenant_id, name, field_type, is_required, category, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [req.tenantId, name, fieldType, isRequired || false, category || null, req.userId]
      );

      await createAuditLog({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: AuditActions.METADATA_FIELD_CREATED,
        documentId: undefined,
        ipAddress: req.ip,
        metadataSnapshot: { fieldName: name, fieldType },
      });

      return fieldResult.rows[0];
    });

    res.status(201).json(result);
  } catch (error: any) {
    next(error);
  }
});

// Update metadata field (Admin only)
router.put('/:id', requireRole('Admin'), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { name, fieldType, isRequired, category } = req.body;

    const result = await query(
      `UPDATE metadata_fields 
       SET name = $1, field_type = $2, is_required = $3, category = $4
       WHERE id = $5 AND tenant_id = $6
       RETURNING *`,
      [name, fieldType, isRequired, category, id, req.tenantId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Metadata field not found', 404);
    }

    await createAuditLog({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: AuditActions.METADATA_FIELD_UPDATED,
        documentId: undefined,
      ipAddress: req.ip,
      metadataSnapshot: { fieldId: id, fieldName: name },
    });

    res.json(result.rows[0]);
  } catch (error: any) {
    next(error);
  }
});

// Delete metadata field (Admin only)
router.delete('/:id', requireRole('Admin'), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    // Check if field is used in any documents
    const usageCheck = await query(
      `SELECT COUNT(*) as count FROM metadata_values WHERE field_id = $1`,
      [id]
    );

    if (parseInt(usageCheck.rows[0].count) > 0) {
      throw new AppError('Cannot delete metadata field that is in use', 400);
    }

    const result = await query(
      `DELETE FROM metadata_fields WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, req.tenantId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Metadata field not found', 404);
    }

    await createAuditLog({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: AuditActions.METADATA_FIELD_DELETED,
        documentId: undefined,
      ipAddress: req.ip,
      metadataSnapshot: { fieldId: id },
    });

    res.json({ message: 'Metadata field deleted successfully' });
  } catch (error: any) {
    next(error);
  }
});

export default router;
