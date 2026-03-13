/**
 * Additional schema tables for password reset and account lockout
 */

import { pgTable, uuid, varchar, timestamp, integer, boolean, unique } from 'drizzle-orm/pg-core';

// Password Reset Tokens
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean('used').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Account Lockout Tracking
export const loginAttempts = pgTable('login_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  tenantId: uuid('tenant_id').notNull(),
  attemptCount: integer('attempt_count').default(0).notNull(),
  lockedUntil: timestamp('locked_until'),
  lastAttempt: timestamp('last_attempt').defaultNow().notNull(),
}, (table) => ({
  emailTenantIdx: unique().on(table.email, table.tenantId),
}));
