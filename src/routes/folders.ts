import express from 'express';
import { query, transaction } from '../database/connection';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = express.Router();

// Get folder permissions
router.get('/:id/permissions', async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT fp.*, 
              r.name as role_name,
              u.name as user_name,
              u.email as user_email
       FROM folder_permissions fp
       LEFT JOIN roles r ON fp.role_id = r.id
       LEFT JOIN users u ON fp.user_id = u.id
       WHERE fp.folder_id = $1 AND fp.folder_id IN (
         SELECT id FROM folders WHERE tenant_id = $2
       )
       ORDER BY r.name NULLS LAST, u.name NULLS LAST`,
      [req.params.id, req.tenantId]
    );

    res.json(result.rows);
  } catch (error: any) {
    next(error);
  }
});

// Set folder permissions
router.post('/:id/permissions', async (req: AuthRequest, res, next) => {
  try {
    const { roleId, userId, canView, canUpload, canEdit, canDelete, canManage } = req.body;

    if (!roleId && !userId) {
      throw new AppError('Either roleId or userId is required', 400);
    }

    // Verify folder exists and belongs to tenant
    const folderCheck = await query(
      `SELECT id FROM folders WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );

    if (folderCheck.rows.length === 0) {
      throw new AppError('Folder not found', 404);
    }

    // Check if permission already exists
    const existingCheck = await query(
      `SELECT id FROM folder_permissions 
       WHERE folder_id = $1 AND (role_id = $2 OR user_id = $3)`,
      [req.params.id, roleId || null, userId || null]
    );

    if (existingCheck.rows.length > 0) {
      // Update existing
      const result = await query(
        `UPDATE folder_permissions 
         SET can_view = $1, can_upload = $2, can_edit = $3, can_delete = $4, can_manage = $5
         WHERE folder_id = $6 AND (role_id = $7 OR user_id = $8)
         RETURNING *`,
        [canView ?? true, canUpload ?? false, canEdit ?? false, canDelete ?? false, canManage ?? false,
         req.params.id, roleId || null, userId || null]
      );
      res.json(result.rows[0]);
    } else {
      // Create new
      const result = await query(
        `INSERT INTO folder_permissions 
         (folder_id, role_id, user_id, can_view, can_upload, can_edit, can_delete, can_manage)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [req.params.id, roleId || null, userId || null, canView ?? true, canUpload ?? false, 
         canEdit ?? false, canDelete ?? false, canManage ?? false]
      );
      res.status(201).json(result.rows[0]);
    }
  } catch (error: any) {
    next(error);
  }
});

// Delete folder permission
router.delete('/:id/permissions/:permissionId', async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `DELETE FROM folder_permissions 
       WHERE id = $1 AND folder_id IN (
         SELECT id FROM folders WHERE tenant_id = $2
       )
       RETURNING *`,
      [req.params.permissionId, req.tenantId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Permission not found', 404);
    }

    res.json({ success: true, message: 'Permission removed successfully' });
  } catch (error: any) {
    next(error);
  }
});

// Get all folders
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT f.*, 
              COUNT(d.id) as document_count,
              u.name as creator_name
       FROM folders f
       LEFT JOIN documents d ON f.id = d.folder_id
       LEFT JOIN users u ON f.created_by = u.id
       WHERE f.tenant_id = $1
       GROUP BY f.id, u.name
       ORDER BY f.name`,
      [req.tenantId]
    );

    res.json(result.rows);
  } catch (error: any) {
    next(error);
  }
});

// Create folder
router.post('/', async (req: AuthRequest, res, next) => {
  try {
    const { name, parentId } = req.body;

    if (!name) {
      throw new AppError('Folder name is required', 400);
    }

    // Check depth (max 3 levels)
    if (parentId) {
      const depthResult = await query(
        `WITH RECURSIVE folder_tree AS (
          SELECT id, parent_id, 1 as depth
          FROM folders
          WHERE id = $1 AND tenant_id = $2
          UNION ALL
          SELECT f.id, f.parent_id, ft.depth + 1
          FROM folders f
          INNER JOIN folder_tree ft ON f.id = ft.parent_id
          WHERE f.tenant_id = $2
        )
        SELECT MAX(depth) as max_depth FROM folder_tree`,
        [parentId, req.tenantId]
      );

      const maxDepth = parseInt(depthResult.rows[0].max_depth || '0');
      if (maxDepth >= 3) {
        throw new AppError('Maximum folder depth (3 levels) reached', 400);
      }
    }

    const result = await query(
      `INSERT INTO folders (tenant_id, name, parent_id, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.tenantId, name, parentId || null, req.userId]
    );

    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    next(error);
  }
});

// Update folder
router.patch('/:id', async (req: AuthRequest, res, next) => {
  try {
    const { name } = req.body;

    if (!name) {
      throw new AppError('Folder name is required', 400);
    }

    const result = await query(
      `UPDATE folders SET name = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [name, req.params.id, req.tenantId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Folder not found', 404);
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    next(error);
  }
});

// Delete folder
router.delete('/:id', async (req: AuthRequest, res, next) => {
  try {
    // Check if folder has documents
    const docCheck = await query(
      `SELECT COUNT(*) as count FROM documents WHERE folder_id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );

    if (parseInt(docCheck.rows[0].count) > 0) {
      throw new AppError('Cannot delete folder with documents', 400);
    }

    // Check if folder has subfolders
    const subfolderCheck = await query(
      `SELECT COUNT(*) as count FROM folders WHERE parent_id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );

    if (parseInt(subfolderCheck.rows[0].count) > 0) {
      throw new AppError('Cannot delete folder with subfolders', 400);
    }

    const result = await query(
      `DELETE FROM folders WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, req.tenantId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Folder not found', 404);
    }

    res.json({ success: true, message: 'Folder deleted successfully' });
  } catch (error: any) {
    next(error);
  }
});

export default router;
