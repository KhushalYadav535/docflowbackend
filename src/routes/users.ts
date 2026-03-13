import express from 'express';
import { query, transaction } from '../database/connection';
import { AuthRequest, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { createAuditLog, AuditActions } from '../services/audit';
import bcrypt from 'bcryptjs';

const router = express.Router();

// Get all users (Admin only)
router.get('/', requireRole('Admin'), async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.name, u.email, u.status, u.last_login, u.created_at,
              ARRAY_AGG(r.name) as roles
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       LEFT JOIN roles r ON ur.role_id = r.id
       WHERE u.tenant_id = $1
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [req.tenantId]
    );

    res.json(result.rows.map((row) => ({ ...row, roles: row.roles.filter((r: string) => r !== null) })));
  } catch (error: any) {
    next(error);
  }
});

// Create user (Admin only)
router.post('/', requireRole('Admin'), async (req: AuthRequest, res, next) => {
  try {
    const { name, email, password, roles, roleIds, status } = req.body;

    if (!name || !email || !password) {
      throw new AppError('Name, email, and password are required', 400);
    }

    if (password.length < 8) {
      throw new AppError('Password must be at least 8 characters', 400);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await transaction(async (client) => {
      // Check if user exists
      const existing = await client.query(
        `SELECT id FROM users WHERE email = $1 AND tenant_id = $2`,
        [email, req.tenantId]
      );

      if (existing.rows.length > 0) {
        throw new AppError('User already exists', 400);
      }

      // Create user
      const userResult = await client.query(
        `INSERT INTO users (tenant_id, name, email, password_hash, status)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, status`,
        [req.tenantId, name, email, hashedPassword, status || 'active']
      );

      const userId = userResult.rows[0].id;

      // Assign roles - support both roleIds array and roles array (role names)
      let finalRoleIds: string[] = [];
      
      if (roleIds && Array.isArray(roleIds) && roleIds.length > 0) {
        finalRoleIds = roleIds;
      } else if (roles && Array.isArray(roles) && roles.length > 0) {
        // Convert role names to role IDs
        for (const roleName of roles) {
          const roleResult = await client.query(
            `SELECT id FROM roles WHERE name = $1 AND tenant_id = $2`,
            [roleName, req.tenantId]
          );
          if (roleResult.rows.length > 0) {
            finalRoleIds.push(roleResult.rows[0].id);
          }
        }
      } else {
        // Default to Staff role
        const staffRole = await client.query(
          `SELECT id FROM roles WHERE name = 'Staff' AND tenant_id = $1`,
          [req.tenantId]
        );
        if (staffRole.rows.length > 0) {
          finalRoleIds.push(staffRole.rows[0].id);
        }
      }

      // Assign roles
      for (const roleId of finalRoleIds) {
        await client.query(
          `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`,
          [userId, roleId]
        );
      }

      return userResult.rows[0];
    });

    await createAuditLog({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: AuditActions.USER_CREATED,
      metadataSnapshot: { createdUserId: result.id, email },
    });

    res.status(201).json(result);
  } catch (error: any) {
    next(error);
  }
});

// Update user (Admin only)
router.patch('/:id', requireRole('Admin'), async (req: AuthRequest, res, next) => {
  try {
    const { name, email, roles, roleIds, status, password } = req.body;

    const result = await transaction(async (client) => {
      const updates: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (name) {
        updates.push(`name = $${paramIndex++}`);
        params.push(name);
      }

      if (email) {
        updates.push(`email = $${paramIndex++}`);
        params.push(email);
      }

      if (status) {
        updates.push(`status = $${paramIndex++}`);
        params.push(status);
      }

      if (updates.length > 0) {
        updates.push(`updated_at = NOW()`);
        params.push(req.params.id, req.tenantId);
        await client.query(
          `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex++} AND tenant_id = $${paramIndex++}`,
          params
        );
      }

      // Update roles
      if (roleIds && Array.isArray(roleIds)) {
        await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [req.params.id]);
        for (const roleId of roleIds) {
          await client.query(
            `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`,
            [req.params.id, roleId]
          );
        }
      }

      const userResult = await client.query(
        `SELECT u.id, u.name, u.email, u.status,
                ARRAY_AGG(r.name) as roles
         FROM users u
         LEFT JOIN user_roles ur ON u.id = ur.user_id
         LEFT JOIN roles r ON ur.role_id = r.id
         WHERE u.id = $1 AND u.tenant_id = $2
         GROUP BY u.id`,
        [req.params.id, req.tenantId]
      );

      return userResult.rows[0];
    });

    if (!result) {
      throw new AppError('User not found', 404);
    }

    await createAuditLog({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: AuditActions.USER_UPDATED,
      metadataSnapshot: { updatedUserId: req.params.id },
    });

    res.json({ 
      ...result, 
      roles: result.roles.filter((r: string) => r !== null),
      role: result.roles.filter((r: string) => r !== null)[0] || 'viewer',
      joinedAt: result.created_at,
    });
  } catch (error: any) {
    next(error);
  }
});

// Delete user (Admin only) - Actually deactivates
router.delete('/:id', requireRole('Admin'), async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `UPDATE users SET status = 'inactive', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id`,
      [req.params.id, req.tenantId]
    );

    if (result.rows.length === 0) {
      throw new AppError('User not found', 404);
    }

    await createAuditLog({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: AuditActions.USER_DEACTIVATED,
      metadataSnapshot: { deactivatedUserId: req.params.id },
    });

    res.json({ success: true, message: 'User deactivated successfully' });
  } catch (error: any) {
    next(error);
  }
});

// Deactivate user (Admin only)
router.patch('/:id/deactivate', requireRole('Admin'), async (req: AuthRequest, res, next) => {
  try {
    const result = await query(
      `UPDATE users SET status = 'inactive', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id`,
      [req.params.id, req.tenantId]
    );

    if (result.rows.length === 0) {
      throw new AppError('User not found', 404);
    }

    await createAuditLog({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: AuditActions.USER_DEACTIVATED,
      metadataSnapshot: { deactivatedUserId: req.params.id },
    });

    res.json({ success: true, message: 'User deactivated successfully' });
  } catch (error: any) {
    next(error);
  }
});

export default router;
