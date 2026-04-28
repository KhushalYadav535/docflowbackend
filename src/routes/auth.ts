import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query, transaction } from '../database/connection';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = express.Router();

// Register - Creates new tenant and user as tenant admin
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, organizationName } = req.body;

    if (!name || !email || !password) {
      throw new AppError('Name, email, and password are required', 400);
    }

    if (password.length < 8) {
      throw new AppError('Password must be at least 8 characters', 400);
    }

    // Check if email already exists globally (across all tenants)
    const existingUserCheck = await query(
      `SELECT id FROM users WHERE email = $1`,
      [email]
    );

    if (existingUserCheck.rows.length > 0) {
      throw new AppError('Email already registered. Please use a different email.', 400);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const tenantName = organizationName || `${name}'s Organization`;

    const result = await transaction(async (client) => {
      // Create new tenant
      const tenantSlug = tenantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const tenantResult = await client.query(
        `INSERT INTO tenants (name, slug)
         VALUES ($1, $2)
         RETURNING id, name, slug`,
        [tenantName, tenantSlug]
      );

      const tenantId = tenantResult.rows[0].id;

      // Create default roles for the new tenant
      const defaultRoles = [
        { name: 'Admin', description: 'Full system access' },
        { name: 'Manager', description: 'Document management and approvals' },
        { name: 'Staff', description: 'Can upload and view documents' },
        { name: 'Viewer', description: 'Read-only access' },
      ];

      const roleMap: Record<string, string> = {};

      for (const role of defaultRoles) {
        const roleResult = await client.query(
          `INSERT INTO roles (tenant_id, name, description)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [tenantId, role.name, role.description]
        );
        roleMap[role.name] = roleResult.rows[0].id;
      }

      // Create user
      const userResult = await client.query(
        `INSERT INTO users (tenant_id, name, email, password_hash, status)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, status`,
        [tenantId, name, email, hashedPassword, 'active']
      );

      const userId = userResult.rows[0].id;

      // Assign Admin role to the registering user (tenant admin)
      await client.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`,
        [userId, roleMap['Admin']]
      );

      return {
        user: userResult.rows[0],
        tenant: tenantResult.rows[0],
      };
    });

    const jwtSecret: string = process.env.JWT_SECRET || 'secret';
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
    const token = jwt.sign(
      { userId: result.user.id, tenantId: result.tenant.id },
      jwtSecret,
      { expiresIn } as jwt.SignOptions
    );

    logger.info('New tenant and admin user created', {
      tenantId: result.tenant.id,
      userId: result.user.id,
      email,
    });

    res.json({
      user: result.user,
      tenant: result.tenant,
      token,
      tenantId: result.tenant.id,
    });
  } catch (error: any) {
    next(error);
  }
});

// Helper function to record failed login attempts
async function recordFailedAttempt(email: string, tenantId: string) {
  const result = await query(
    `SELECT attempt_count FROM login_attempts WHERE email = $1 AND tenant_id = $2`,
    [email, tenantId]
  );

  if (result.rows.length === 0) {
    await query(
      `INSERT INTO login_attempts (email, tenant_id, attempt_count, last_attempt)
       VALUES ($1, $2, 1, NOW())`,
      [email, tenantId]
    );
  } else {
    const attemptCount = result.rows[0].attempt_count + 1;
    
    if (attemptCount >= 5) {
      // Lock account for 15 minutes
      const lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      await query(
        `UPDATE login_attempts 
         SET attempt_count = $1, locked_until = $2, last_attempt = NOW()
         WHERE email = $3 AND tenant_id = $4`,
        [attemptCount, lockedUntil, email, tenantId]
      );
    } else {
      await query(
        `UPDATE login_attempts 
         SET attempt_count = $1, last_attempt = NOW()
         WHERE email = $2 AND tenant_id = $3`,
        [attemptCount, email, tenantId]
      );
    }
  }
}

// Login with account lockout
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError('Email and password are required', 400);
    }

    // Find user by email (check all tenants)
    const userResult = await query(
      `SELECT u.id, u.name, u.email, u.password_hash, u.status, u.tenant_id
       FROM users u
       WHERE u.email = $1`,
      [email]
    );

    if (userResult.rows.length === 0) {
      throw new AppError('Invalid email or password', 401);
    }

    const user = userResult.rows[0];
    const tenantId = user.tenant_id;

    // Check if account is locked
    const lockResult = await query(
      `SELECT locked_until FROM login_attempts WHERE email = $1 AND tenant_id = $2`,
      [email, tenantId]
    );

    if (lockResult.rows.length > 0 && lockResult.rows[0].locked_until) {
      const lockedUntil = new Date(lockResult.rows[0].locked_until);
      if (lockedUntil > new Date()) {
        const minutesLeft = Math.ceil((lockedUntil.getTime() - Date.now()) / 60000);
        throw new AppError(`Account locked. Try again in ${minutesLeft} minutes.`, 423);
      }
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      await recordFailedAttempt(email, tenantId);
      throw new AppError('Invalid email or password', 401);
    }

    // Check if user is active
    if (user.status !== 'active') {
      throw new AppError('Account is inactive. Please contact administrator.', 403);
    }

    // Clear failed attempts on successful login
    await query(
      `DELETE FROM login_attempts WHERE email = $1 AND tenant_id = $2`,
      [email, tenantId]
    );

    // Update last login
    await query(
      `UPDATE users SET last_login = NOW() WHERE id = $1`,
      [user.id]
    );

    // Get user roles
    const rolesResult = await query(
      `SELECT r.name FROM roles r
       INNER JOIN user_roles ur ON r.id = ur.role_id
       WHERE ur.user_id = $1 AND r.tenant_id = $2`,
      [user.id, tenantId]
    );

    const jwtSecret: string = process.env.JWT_SECRET || 'secret';
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
    const token = jwt.sign(
      { userId: user.id, tenantId },
      jwtSecret,
      { expiresIn } as jwt.SignOptions
    );

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles: rolesResult.rows.map((r: { name: string }) => r.name),
      },
      token,
      tenantId,
    });
  } catch (error: any) {
    next(error);
  }
});

// Forgot password
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new AppError('Email is required', 400);
    }

    // Find user by email
    const userResult = await query(
      `SELECT u.id, u.email, u.tenant_id FROM users u WHERE u.email = $1`,
      [email]
    );

    if (userResult.rows.length === 0) {
      // Don't reveal if user exists
      return res.json({ message: 'If email exists, password reset link sent' });
    }

    const user = userResult.rows[0];

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Invalidate old tokens
    await query(
      `UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false`,
      [user.id]
    );

    // Store new token
    await query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, resetToken, expiresAt]
    );

    // In production, send email here
    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
    logger.info('Password reset link generated', { email, resetLink });

    res.json({ message: 'If email exists, password reset link sent', resetLink });
  } catch (error: any) {
    next(error);
  }
});

// Reset password
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      throw new AppError('Token and new password are required', 400);
    }

    if (newPassword.length < 8) {
      throw new AppError('Password must be at least 8 characters', 400);
    }

    // Find valid token
    const tokenResult = await query(
      `SELECT prt.user_id, prt.expires_at, u.email
       FROM password_reset_tokens prt
       INNER JOIN users u ON prt.user_id = u.id
       WHERE prt.token = $1 AND prt.used = false AND prt.expires_at > NOW()`,
      [token]
    );

    if (tokenResult.rows.length === 0) {
      throw new AppError('Invalid or expired reset token', 400);
    }

    const { user_id, tenant_id } = tokenResult.rows[0];

    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await query(
      `UPDATE users SET password_hash = $1 WHERE id = $2`,
      [hashedPassword, user_id]
    );

    // Mark token as used
    await query(
      `UPDATE password_reset_tokens SET used = true WHERE token = $1`,
      [token]
    );

    res.json({ message: 'Password reset successfully' });
  } catch (error: any) {
    next(error);
  }
});

export default router;
