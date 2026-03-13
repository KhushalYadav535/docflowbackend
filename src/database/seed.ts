import { query, transaction } from './connection';
import bcrypt from 'bcryptjs';
import { logger } from '../utils/logger';

async function seed() {
  try {
    logger.info('Starting database seed...');

    await transaction(async (client) => {
      // Create default tenant
      const tenantResult = await client.query(
        `INSERT INTO tenants (id, name, slug) 
         VALUES ('default-tenant-id', 'Default Organization', 'default')
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`
      );

      const tenantId = tenantResult.rows[0].id;

      // Create default roles
      const roles = [
        { name: 'Admin', description: 'Full system access' },
        { name: 'Manager', description: 'Document management and approvals' },
        { name: 'Staff', description: 'Can upload and view documents' },
        { name: 'Viewer', description: 'Read-only access' },
      ];

      const roleMap: Record<string, string> = {};

      for (const role of roles) {
        const roleResult = await client.query(
          `INSERT INTO roles (tenant_id, name, description)
           VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, name) DO UPDATE SET description = EXCLUDED.description
           RETURNING id`,
          [tenantId, role.name, role.description]
        );
        roleMap[role.name] = roleResult.rows[0].id;
      }

      // Create permissions
      const permissions = [
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

      for (const perm of permissions) {
        const permResult = await client.query(
          `INSERT INTO permissions (action, resource, description)
           VALUES ($1, $2, $3)
           ON CONFLICT (action, resource) DO NOTHING
           RETURNING id`,
          [perm.action, perm.resource, `${perm.action} ${perm.resource}`]
        );
        if (permResult.rows.length > 0) {
          permissionMap[`${perm.action}:${perm.resource}`] = permResult.rows[0].id;
        }
      }

      // Assign permissions to roles
      const rolePermissions: Record<string, string[]> = {
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

      for (const [roleName, permKeys] of Object.entries(rolePermissions)) {
        const roleId = roleMap[roleName];
        for (const permKey of permKeys) {
          const permId = permissionMap[permKey];
          if (permId) {
            await client.query(
              `INSERT INTO role_permissions (role_id, permission_id)
               VALUES ($1, $2)
               ON CONFLICT DO NOTHING`,
              [roleId, permId]
            );
          }
        }
      }

      // Create default admin user
      const adminPassword = await bcrypt.hash('admin123', 10);
      const adminResult = await client.query(
        `INSERT INTO users (tenant_id, name, email, password_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash
         RETURNING id`,
        [tenantId, 'Admin User', 'admin@docflow.com', adminPassword]
      );

      const adminId = adminResult.rows[0].id;

      // Assign Admin role
      await client.query(
        `INSERT INTO user_roles (user_id, role_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [adminId, roleMap['Admin']]
      );

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
