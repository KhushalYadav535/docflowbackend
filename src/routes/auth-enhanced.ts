import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query, transaction } from '../database/connection';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = express.Router();

// Enhanced login with account lockout
router.post('/login', async (req, res, next) => {
  try {
    const { email, password, tenantId } = req.body;

    if (!email || !password) {
      throw new AppError('Email and password are required', 400);
    }

    const finalTenantId = tenantId || process.env.DEFAULT_TENANT_ID || 'default-tenant-id';

    // Check account lockout
    const lockoutCheck = await query(
      `SELECT attempt_count, locked_until FROM login_attempts 
       WHERE email = $1 AND tenant_id = $2`,
      [email, finalTenantId]
    );

    if (lockoutCheck.rows.length > 0) {
      const lockout = lockoutCheck.rows[0];
      if (lockout.locked_until && new Date(lockout.locked_until) > new Date()) {
        const minutesLeft = Math.ceil((new Date(lockout.locked_until).getTime() - Date.now()) / 60000);
        throw new AppError(`Account locked. Try again in ${minutesLeft} minutes`, 423);
      }
    }

    const result = await query(
      `SELECT u.id, u.name, u.email, u.password_hash, u.status, u.tenant_id,
              ARRAY_AGG(r.name) as roles
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       LEFT JOIN roles r ON ur.role_id = r.id
       WHERE u.email = $1 AND u.tenant_id = $2
       GROUP BY u.id`,
      [email, finalTenantId]
    );

    if (result.rows.length === 0) {
      await recordFailedAttempt(email, finalTenantId);
      throw new AppError('Invalid credentials', 401);
    }

    const user = result.rows[0];

    if (user.status !== 'active') {
      throw new AppError('Account is inactive', 403);
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      await recordFailedAttempt(email, finalTenantId);
      throw new AppError('Invalid credentials', 401);
    }

    // Reset failed attempts on successful login
    await query(
      `DELETE FROM login_attempts WHERE email = $1 AND tenant_id = $2`,
      [email, finalTenantId]
    );

    // Update last login
    await query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [user.id]);

    const jwtSecret: string = process.env.JWT_SECRET || 'secret';
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
    const token = jwt.sign(
      { userId: user.id, tenantId: user.tenant_id },
      jwtSecret,
      { expiresIn } as jwt.SignOptions
    );

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles: user.roles.filter((r: string) => r !== null),
      },
      token,
      tenantId: user.tenant_id,
    });
  } catch (error: any) {
    next(error);
  }
});

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

// Enhanced password reset request
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email, tenantId } = req.body;

    if (!email) {
      throw new AppError('Email is required', 400);
    }

    const finalTenantId = tenantId || process.env.DEFAULT_TENANT_ID || 'default-tenant-id';

    const result = await query(
      `SELECT id FROM users WHERE email = $1 AND tenant_id = $2`,
      [email, finalTenantId]
    );

    // Don't reveal if user exists (security best practice)
    if (result.rows.length > 0) {
      const userId = result.rows[0].id;
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Invalidate old tokens
      await query(
        `UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false`,
        [userId]
      );

      // Create new token
      await query(
        `INSERT INTO password_reset_tokens (user_id, token, expires_at)
         VALUES ($1, $2, $3)`,
        [userId, resetToken, expiresAt]
      );

      // In production, send email with reset link
      // For now, log it (in production, use nodemailer or similar)
      logger.info('Password reset token generated', { 
        email, 
        userId,
        resetLink: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}` 
      });
    }

    res.json({
      message: 'If the email exists, a password reset link has been sent',
    });
  } catch (error: any) {
    next(error);
  }
});

// Reset password with token
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
      `SELECT prt.user_id, u.tenant_id 
       FROM password_reset_tokens prt
       INNER JOIN users u ON prt.user_id = u.id
       WHERE prt.token = $1 
         AND prt.used = false 
         AND prt.expires_at > NOW()`,
      [token]
    );

    if (tokenResult.rows.length === 0) {
      throw new AppError('Invalid or expired reset token', 400);
    }

    const { user_id, tenant_id } = tokenResult.rows[0];
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await transaction(async (client) => {
      // Update password
      await client.query(
        `UPDATE users SET password_hash = $1 WHERE id = $2`,
        [hashedPassword, user_id]
      );

      // Mark token as used
      await client.query(
        `UPDATE password_reset_tokens SET used = true WHERE token = $1`,
        [token]
      );
    });

    logger.info('Password reset successful', { userId: user_id });

    res.json({
      message: 'Password reset successfully',
    });
  } catch (error: any) {
    next(error);
  }
});

export default router;
