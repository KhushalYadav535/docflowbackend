/**
 * Database Helper Functions using Drizzle ORM
 */

import { db } from './db';
import { eq, and, desc, sql, ilike, gte, lte, count } from 'drizzle-orm';
import {
  documents,
  documentVersions,
  folders,
  users,
  metadataFields,
  metadataValues,
  searchIndex,
  auditLogs,
  roles,
  userRoles,
  tenants,
} from './schema';

// Document helpers
export async function findDocumentById(documentId: string, tenantId: string) {
  return await db.query.documents.findFirst({
    where: and(eq(documents.id, documentId), eq(documents.tenantId, tenantId)),
    with: {
      folder: true,
      creator: {
        columns: {
          id: true,
          name: true,
          email: true,
        },
      },
      versions: {
        where: eq(documentVersions.id, documents.currentVersionId),
        limit: 1,
      },
    },
  });
}

export async function findDocumentWithMetadata(documentId: string, tenantId: string) {
  const doc = await findDocumentById(documentId, tenantId);
  if (!doc) return null;

  const metadata = await db.query.metadataValues.findMany({
    where: eq(metadataValues.documentId, documentId),
    with: {
      field: true,
    },
  });

  return {
    ...doc,
    metadata: metadata.reduce((acc: any, mv: any) => {
      acc[mv.field.name] = mv.value;
      return acc;
    }, {}),
  };
}

export async function checkDuplicateChecksum(checksum: string, tenantId: string) {
  const result = await db
    .select({
      versionId: documentVersions.id,
      documentId: documents.id,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documentVersions.documentId, documents.id))
    .where(and(eq(documentVersions.checksum, checksum), eq(documents.tenantId, tenantId)))
    .limit(1);

  return result[0] || null;
}

export async function generateDocumentNumber(tenantId: string) {
  const year = new Date().getFullYear();
  const countResult = await db
    .select({ count: count() })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, tenantId),
        sql`EXTRACT(YEAR FROM ${documents.createdAt}) = ${year}`
      )
    );

  const sequence = (countResult[0]?.count || 0) + 1;
  return `DOC-${year}-${sequence.toString().padStart(4, '0')}`;
}

// Search helpers
export async function searchDocuments(
  query: string,
  tenantId: string,
  filters?: {
    dateFrom?: string;
    dateTo?: string;
    documentType?: string;
    department?: string;
    uploadedBy?: string;
    folderId?: string;
    status?: string;
  }
) {
  let whereConditions: any[] = [eq(documents.tenantId, tenantId)];

  if (query) {
    whereConditions.push(
      sql`(
        ${documents.name} ILIKE ${`%${query}%`} OR
        EXISTS (
          SELECT 1 FROM ${searchIndex}
          WHERE ${searchIndex.documentId} = ${documents.id}
          AND ${searchIndex.extractedText} ILIKE ${`%${query}%`}
        )
      )`
    );
  }

  if (filters?.dateFrom) {
    whereConditions.push(gte(documents.createdAt, new Date(filters.dateFrom)));
  }

  if (filters?.dateTo) {
    whereConditions.push(lte(documents.createdAt, new Date(filters.dateTo)));
  }

  if (filters?.status) {
    whereConditions.push(eq(documents.status, filters.status as any));
  }

  if (filters?.folderId) {
    whereConditions.push(eq(documents.folderId, filters.folderId));
  }

  const results = await db
    .select({
      id: documents.id,
      docNumber: documents.docNumber,
      name: documents.name,
      status: documents.status,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
      uploaderName: users.name,
      folderName: folders.name,
      versionNumber: documentVersions.versionNumber,
      relevance: sql<number>`ts_rank(
        to_tsvector('english', COALESCE(${searchIndex.extractedText}, '')),
        plainto_tsquery('english', ${query || ''})
      )`.as('relevance'),
    })
    .from(documents)
    .leftJoin(users, eq(documents.createdBy, users.id))
    .leftJoin(folders, eq(documents.folderId, folders.id))
    .leftJoin(documentVersions, eq(documents.currentVersionId, documentVersions.id))
    .leftJoin(searchIndex, eq(documents.id, searchIndex.documentId))
    .where(and(...whereConditions))
    .orderBy(desc(sql`relevance`), desc(documents.createdAt))
    .limit(50);

  return results;
}

// Folder helpers
export async function getFolderDepth(folderId: string, tenantId: string): Promise<number> {
  if (!folderId) return 0;

  const folder = await db.query.folders.findFirst({
    where: and(eq(folders.id, folderId), eq(folders.tenantId, tenantId)),
  });

  if (!folder || !folder.parentId) return 1;

  return 1 + (await getFolderDepth(folder.parentId, tenantId));
}

// User helpers
export async function getUserWithRoles(userId: string, tenantId: string) {
  const user = await db.query.users.findFirst({
    where: and(eq(users.id, userId), eq(users.tenantId, tenantId)),
  });

  if (!user) return null;

  const userRolesData = await db.query.userRoles.findMany({
    where: eq(userRoles.userId, userId),
    with: {
      role: true,
    },
  });

  return {
    ...user,
    roles: userRolesData.map((ur) => ur.role.name),
  };
}

// Audit helpers
export async function createAuditLogEntry(data: {
  tenantId: string;
  userId: string;
  action: string;
  documentId?: string;
  metadataSnapshot?: any;
  ipAddress?: string;
}) {
  return await db.insert(auditLogs).values({
    tenantId: data.tenantId,
    userId: data.userId,
    action: data.action,
    documentId: data.documentId || null,
    metadataSnapshot: data.metadataSnapshot || null,
    ipAddress: data.ipAddress || null,
  });
}
