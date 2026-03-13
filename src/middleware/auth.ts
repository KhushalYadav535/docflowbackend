import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../database/connection';
import { logger } from '../utils/logger';

export interface AuthRequest extends Request {
  userId?: string;
  tenantId?: string;
  userRole?: string[];
}

export async function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    let decoded: { userId: string; tenantId: string };
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as {
        userId: string;
        tenantId: string;
      };
    } catch (jwtError) {
      logger.warn('JWT verification failed', { error: (jwtError as Error).message });
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Verify user exists and is active - with retry for DB connection issues
    let userResult;
    try {
      userResult = await query(
        `SELECT id, tenant_id, status FROM users WHERE id = $1 AND tenant_id = $2`,
        [decoded.userId, decoded.tenantId]
      );
    } catch (dbError) {
      logger.error('Database error during authentication', { error: (dbError as Error).message });
      return res.status(503).json({ error: 'Service temporarily unavailable. Please try again.' });
    }

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const user = userResult.rows[0];
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is inactive' });
    }

    // Get user roles
    let rolesResult;
    try {
      rolesResult = await query(
        `SELECT r.name FROM roles r
         INNER JOIN user_roles ur ON r.id = ur.role_id
         WHERE ur.user_id = $1 AND r.tenant_id = $2`,
        [decoded.userId, decoded.tenantId]
      );
    } catch (dbError) {
      logger.error('Database error fetching roles', { error: (dbError as Error).message });
      return res.status(503).json({ error: 'Service temporarily unavailable. Please try again.' });
    }

    req.userId = decoded.userId;
    req.tenantId = decoded.tenantId;
    req.userRole = rolesResult.rows.map((r: { name: string }) => r.name);

    // Verify tenant ID matches header
    const headerTenantId = req.headers['x-tenant-id'];
    if (headerTenantId && headerTenantId !== decoded.tenantId) {
      return res.status(403).json({ error: 'Tenant mismatch' });
    }

    next();
  } catch (error) {
    logger.error('Authentication error', { error: (error as Error).message });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userRole) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const hasRole = allowedRoles.some((role) => req.userRole?.includes(role));
    if (!hasRole) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}
