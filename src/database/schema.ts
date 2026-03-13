/**
 * Drizzle ORM Schema for Document Management System
 * Compatible with Neon PostgreSQL
 */

import { pgTable, uuid, varchar, text, timestamp, boolean, integer, bigint, jsonb, pgEnum, index, unique } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Import additional schema tables
export { passwordResetTokens, loginAttempts } from './schema-additions';

// Enums
export const userStatusEnum = pgEnum('user_status', ['active', 'inactive']);
export const documentStatusEnum = pgEnum('document_status', ['draft', 'indexed', 'ocr_failed', 'under_review', 'approved', 'archived']);
export const ocrStatusEnum = pgEnum('ocr_status', ['pending', 'processing', 'completed', 'failed']);
export const fieldTypeEnum = pgEnum('field_type', ['text', 'number', 'date', 'dropdown']);
export const categoryStatusEnum = pgEnum('category_status', ['active', 'inactive']);

// Tenants
export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  logoUrl: text('logo_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Users
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  status: userStatusEnum('status').default('active').notNull(),
  lastLogin: timestamp('last_login'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  tenantEmailIdx: unique().on(table.tenantId, table.email),
  tenantIdx: index('idx_users_tenant').on(table.tenantId),
  emailIdx: index('idx_users_email').on(table.email),
}));

// Roles
export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tenantNameIdx: unique().on(table.tenantId, table.name),
  tenantIdx: index('idx_roles_tenant').on(table.tenantId),
}));

// Permissions
export const permissions = pgTable('permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  action: varchar('action', { length: 100 }).notNull(),
  resource: varchar('resource', { length: 100 }).notNull(),
  description: text('description'),
}, (table) => ({
  actionResourceIdx: unique().on(table.action, table.resource),
}));

// Role Permissions
export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: unique().on(table.roleId, table.permissionId),
}));

// User Roles
export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: unique().on(table.userId, table.roleId),
  userIdx: index('idx_user_roles_user').on(table.userId),
  roleIdx: index('idx_user_roles_role').on(table.roleId),
}));

// Folders
export const folders = pgTable('folders', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  parentId: uuid('parent_id').references((): any => folders.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index('idx_folders_tenant').on(table.tenantId),
  parentIdx: index('idx_folders_parent').on(table.parentId),
}));

// Documents
export const documents = pgTable('documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  docNumber: varchar('doc_number', { length: 100 }).unique(),
  name: varchar('name', { length: 255 }).notNull(),
  folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
  currentVersionId: uuid('current_version_id'),
  status: documentStatusEnum('status').default('draft').notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index('idx_documents_tenant').on(table.tenantId),
  folderIdx: index('idx_documents_folder').on(table.folderId),
  statusIdx: index('idx_documents_status').on(table.status),
  createdByIdx: index('idx_documents_created_by').on(table.createdBy),
}));

// Document Versions
export const documentVersions = pgTable('document_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  filePath: text('file_path').notNull(),
  fileSize: bigint('file_size', { mode: 'number' }).notNull(),
  fileType: varchar('file_type', { length: 50 }).notNull(),
  checksum: varchar('checksum', { length: 64 }).notNull(),
  ocrText: text('ocr_text'),
  ocrStatus: ocrStatusEnum('ocr_status').default('pending').notNull(),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
  changeNote: text('change_note'),
}, (table) => ({
  documentVersionIdx: unique().on(table.documentId, table.versionNumber),
  documentIdx: index('idx_versions_document').on(table.documentId),
  checksumIdx: index('idx_versions_checksum').on(table.checksum),
}));

// Metadata Fields
export const metadataFields = pgTable('metadata_fields', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  fieldType: fieldTypeEnum('field_type').notNull(),
  isRequired: boolean('is_required').default(false).notNull(),
  category: varchar('category', { length: 100 }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tenantNameIdx: unique().on(table.tenantId, table.name),
  tenantIdx: index('idx_metadata_fields_tenant').on(table.tenantId),
}));

// Metadata Values
export const metadataValues = pgTable('metadata_values', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  fieldId: uuid('field_id').notNull().references(() => metadataFields.id, { onDelete: 'cascade' }),
  value: text('value').notNull(),
  updatedBy: uuid('updated_by').notNull().references(() => users.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  documentFieldIdx: unique().on(table.documentId, table.fieldId),
  documentIdx: index('idx_metadata_values_document').on(table.documentId),
  fieldIdx: index('idx_metadata_values_field').on(table.fieldId),
}));

// Search Index
export const searchIndex = pgTable('search_index', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id').notNull().references(() => documentVersions.id, { onDelete: 'cascade' }),
  extractedText: text('extracted_text').notNull(),
  indexedAt: timestamp('indexed_at').defaultNow().notNull(),
}, (table) => ({
  documentVersionIdx: unique().on(table.documentId, table.versionId),
  documentIdx: index('idx_search_index_document').on(table.documentId),
}));

// Audit Logs
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  action: varchar('action', { length: 100 }).notNull(),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  metadataSnapshot: jsonb('metadata_snapshot'),
  ipAddress: varchar('ip_address', { length: 45 }),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index('idx_audit_logs_tenant').on(table.tenantId),
  userIdx: index('idx_audit_logs_user').on(table.userId),
  documentIdx: index('idx_audit_logs_document').on(table.documentId),
  timestampIdx: index('idx_audit_logs_timestamp').on(table.timestamp),
  actionIdx: index('idx_audit_logs_action').on(table.action),
}));

// Notifications
export const notifications = pgTable('notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  message: text('message').notNull(),
  link: text('link'),
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdx: index('idx_notifications_user').on(table.userId),
  readIdx: index('idx_notifications_read').on(table.isRead),
}));

// Document Categories
export const documentCategories = pgTable('document_categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  status: categoryStatusEnum('status').default('active').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  tenantNameIdx: unique().on(table.tenantId, table.name),
  tenantIdx: index('idx_categories_tenant').on(table.tenantId),
}));

// System Settings
export const systemSettings = pgTable('system_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  key: varchar('key', { length: 255 }).notNull(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  tenantKeyIdx: unique().on(table.tenantId, table.key),
  tenantIdx: index('idx_settings_tenant').on(table.tenantId),
}));

// Relations
export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  roles: many(roles),
  folders: many(folders),
  documents: many(documents),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
  roles: many(userRoles),
  createdDocuments: many(documents),
  createdFolders: many(folders),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [documents.tenantId],
    references: [tenants.id],
  }),
  folder: one(folders, {
    fields: [documents.folderId],
    references: [folders.id],
  }),
  creator: one(users, {
    fields: [documents.createdBy],
    references: [users.id],
  }),
  versions: many(documentVersions),
  metadataValues: many(metadataValues),
  auditLogs: many(auditLogs),
}));

export const documentVersionsRelations = relations(documentVersions, ({ one }) => ({
  document: one(documents, {
    fields: [documentVersions.documentId],
    references: [documents.id],
  }),
  uploader: one(users, {
    fields: [documentVersions.uploadedBy],
    references: [users.id],
  }),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
}));

export const rolesRelations = relations(roles, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [roles.tenantId],
    references: [tenants.id],
  }),
  users: many(userRoles),
}));
