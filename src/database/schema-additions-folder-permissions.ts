// Folder Permissions Schema Addition
import { pgTable, uuid, varchar, boolean, index, unique } from 'drizzle-orm/pg-core';
import { folders } from './schema';
import { roles } from './schema';
import { users } from './schema';

// Folder Permissions - Override role-based permissions at folder level
export const folderPermissions = pgTable('folder_permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  folderId: uuid('folder_id').notNull().references(() => folders.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').references(() => roles.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  // Permissions
  canView: boolean('can_view').default(true).notNull(),
  canUpload: boolean('can_upload').default(false).notNull(),
  canEdit: boolean('can_edit').default(false).notNull(),
  canDelete: boolean('can_delete').default(false).notNull(),
  canManage: boolean('can_manage').default(false).notNull(), // Manage folder itself
}, (table) => ({
  folderRoleIdx: unique().on(table.folderId, table.roleId),
  folderUserIdx: unique().on(table.folderId, table.userId),
  folderIdx: index('idx_folder_permissions_folder').on(table.folderId),
}));
