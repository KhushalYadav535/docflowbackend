/**
 * Database Seed using Drizzle ORM
 * Run with: npm run seed
 */

import { db } from './db';
import {
  tenants,
  users,
  roles,
  permissions,
  rolePermissions,
  userRoles,
} from './schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { logger } from '../utils/logger';

async function seed() {
  try {
    logger.info('Starting database seed with Drizzle ORM...');

    await db.transaction(async (tx) => {
      // Create default tenant
      const [tenant] = await tx
        .insert(tenants)
        .values({
          id: 'default-tenant-id',
          name: 'Default Organization',
          slug: 'default',
        })
        .onConflictDoUpdate({
          target: tenants.slug,
          set: { name: 'Default Organization' },
        })
        .returning();

      const tenantId = tenant.id;

      // Create default roles
      const rolesData = [
        { name: 'Admin', description: 'Full system access' },
        { name: 'Manager', description: 'Document management and approvals' },
        { name: 'Staff', description: 'Can upload and view documents' },
        { name: 'Viewer', description: 'Read-only access' },
      ];

      const roleMap: Record<string, string> = {};

      for (const roleData of rolesData) {
        const [role] = await tx
          .insert(roles)
          .values({
            tenantId,
            name: roleData.name,
            description: roleData.description,
          })
          .onConflictDoUpdate({
            target: [roles.tenantId, roles.name],
            set: { description: roleData.description },
          })
          .returning();
        roleMap[roleData.name] = role.id;
      }

      // Create permissions
      const permissionsData = [
        { action: 'upload', resource: 'document' },
        { action: 'view', resource: 'document' },
        { action: 'download', resource: 'document' },
        { action: 'edit', resource: 'metadata' },
        { action: 'delete', resource: 'document' },
        { action: 'upload_version', resource: 'document' },
        { action: 'restore_version', resource: 'document' },
        { action: 'approve_reject', resource: 'document' },
        { action: 'manage', resource: 'users' },
        { action: 'manage', resource: 'roles' },
        { action: 'view', resource: 'audit_logs' },
        { action: 'export', resource: 'audit_logs' },
      ];

      const permissionMap: Record<string, string> = {};

      for (const permData of permissionsData) {
        const [perm] = await tx
          .insert(permissions)
          .values({
            action: permData.action,
            resource: permData.resource,
            description: `${permData.action} ${permData.resource}`,
          })
          .onConflictDoUpdate({
            target: [permissions.action, permissions.resource],
            set: { description: `${permData.action} ${permData.resource}` },
          })
          .returning();
        permissionMap[`${permData.action}:${permData.resource}`] = perm.id;
      }

      // Assign permissions to roles
      const rolePermissionsMap: Record<string, string[]> = {
        Admin: [
          'upload:document',
          'view:document',
          'download:document',
          'edit:metadata',
          'delete:document',
          'upload_version:document',
          'restore_version:document',
          'approve_reject:document',
          'manage:users',
          'manage:roles',
          'view:audit_logs',
          'export:audit_logs',
        ],
        Manager: [
          'upload:document',
          'view:document',
          'download:document',
          'edit:metadata',
          'upload_version:document',
          'restore_version:document',
          'approve_reject:document',
          'view:audit_logs',
        ],
        Staff: [
          'upload:document',
          'view:document',
          'download:document',
          'edit:metadata',
          'upload_version:document',
        ],
        Viewer: ['view:document', 'download:document'],
      };

      for (const [roleName, permKeys] of Object.entries(rolePermissionsMap)) {
        const roleId = roleMap[roleName];
        for (const permKey of permKeys) {
          const permId = permissionMap[permKey];
          if (permId) {
            await tx
              .insert(rolePermissions)
              .values({
                roleId,
                permissionId: permId,
              })
              .onConflictDoNothing();
          }
        }
      }

      // Create default admin user
      const adminPassword = await bcrypt.hash('admin123', 10);
      const [admin] = await tx
        .insert(users)
        .values({
          tenantId,
          name: 'Admin User',
          email: 'admin@docflow.com',
          passwordHash: adminPassword,
          status: 'active',
        })
        .onConflictDoUpdate({
          target: [users.tenantId, users.email],
          set: { passwordHash: adminPassword },
        })
        .returning();

      // Assign Admin role
      await tx
        .insert(userRoles)
        .values({
          userId: admin.id,
          roleId: roleMap['Admin'],
        })
        .onConflictDoNothing();

      logger.info('Database seeded successfully!');
      logger.info('Default admin user: admin@docflow.com / admin123');
    });
  } catch (error) {
    logger.error('Seed failed', error);
    throw error;
  }
}

seed()
  .then(() => {
    logger.info('Seed completed');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Seed error', error);
    process.exit(1);
  });
