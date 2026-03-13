import { db } from '../database/db';
import { auditLogs } from '../database/schema';
import { logger } from '../utils/logger';

export interface AuditLogData {
  tenantId: string;
  userId: string;
  action: string;
  documentId?: string;
  metadataSnapshot?: any;
  ipAddress?: string;
}

export async function createAuditLog(data: AuditLogData): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      tenantId: data.tenantId,
      userId: data.userId,
      action: data.action,
      documentId: data.documentId || null,
      metadataSnapshot: data.metadataSnapshot || null,
      ipAddress: data.ipAddress || null,
    });
  } catch (error) {
    logger.error('Failed to create audit log', { error, data });
    // Don't throw - audit logging should not break the main flow
  }
}

// Export for use in helpers
export async function createAuditLogEntry(data: AuditLogData): Promise<void> {
  return createAuditLog(data);
}

export const AuditActions = {
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  DOCUMENT_VIEWED: 'DOCUMENT_VIEWED',
  DOCUMENT_DOWNLOADED: 'DOCUMENT_DOWNLOADED',
  DOCUMENT_DELETED: 'DOCUMENT_DELETED',
  DOCUMENT_UPDATED: 'DOCUMENT_UPDATED',
  VERSION_UPLOADED: 'VERSION_UPLOADED',
  VERSION_RESTORED: 'VERSION_RESTORED',
  METADATA_UPDATED: 'METADATA_UPDATED',
  METADATA_FIELD_CREATED: 'METADATA_FIELD_CREATED',
  METADATA_FIELD_UPDATED: 'METADATA_FIELD_UPDATED',
  METADATA_FIELD_DELETED: 'METADATA_FIELD_DELETED',
  DOCUMENT_MOVED: 'DOCUMENT_MOVED',
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  DOCUMENT_SUBMITTED_FOR_REVIEW: 'DOCUMENT_SUBMITTED_FOR_REVIEW',
  DOCUMENT_APPROVED: 'DOCUMENT_APPROVED',
  DOCUMENT_REJECTED: 'DOCUMENT_REJECTED',
  CATEGORY_CREATED: 'CATEGORY_CREATED',
  CATEGORY_UPDATED: 'CATEGORY_UPDATED',
  CATEGORY_DELETED: 'CATEGORY_DELETED',
  OCR_TRIGGERED: 'OCR_TRIGGERED',
  OCR_COMPLETED: 'OCR_COMPLETED',
  OCR_FAILED: 'OCR_FAILED',
};
