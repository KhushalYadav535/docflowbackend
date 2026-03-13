# Migration Guide: Raw SQL to Drizzle ORM

## Overview

This guide helps you migrate from raw SQL queries to Drizzle ORM for better type safety and Neon compatibility.

## Step 1: Install Dependencies

```bash
npm install @neondatabase/serverless drizzle-orm drizzle-kit postgres
```

## Step 2: Update Database Connection

**Old (`src/database/connection.ts`):**
```typescript
import { Pool } from 'pg';
const pool = new Pool({ ... });
export async function query(text: string, params?: any[]) { ... }
```

**New (`src/database/db.ts`):**
```typescript
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
export const db = drizzle(sql, { schema });
```

## Step 3: Replace Query Patterns

### SELECT Queries

**Old:**
```typescript
const result = await query(
  `SELECT * FROM documents WHERE id = $1 AND tenant_id = $2`,
  [documentId, tenantId]
);
const doc = result.rows[0];
```

**New:**
```typescript
import { eq, and } from 'drizzle-orm';
const doc = await db.query.documents.findFirst({
  where: and(eq(documents.id, documentId), eq(documents.tenantId, tenantId)),
});
```

### INSERT Queries

**Old:**
```typescript
const result = await query(
  `INSERT INTO documents (tenant_id, name, created_by) VALUES ($1, $2, $3) RETURNING *`,
  [tenantId, name, userId]
);
const newDoc = result.rows[0];
```

**New:**
```typescript
const [newDoc] = await db.insert(documents).values({
  tenantId,
  name,
  createdBy: userId,
}).returning();
```

### UPDATE Queries

**Old:**
```typescript
await query(
  `UPDATE documents SET name = $1 WHERE id = $2`,
  [newName, documentId]
);
```

**New:**
```typescript
await db.update(documents)
  .set({ name: newName })
  .where(eq(documents.id, documentId));
```

### DELETE Queries

**Old:**
```typescript
await query(`DELETE FROM folders WHERE id = $1`, [folderId]);
```

**New:**
```typescript
await db.delete(folders).where(eq(folders.id, folderId));
```

### JOIN Queries

**Old:**
```typescript
const result = await query(
  `SELECT d.*, u.name as uploader_name 
   FROM documents d
   LEFT JOIN users u ON d.created_by = u.id
   WHERE d.tenant_id = $1`,
  [tenantId]
);
```

**New:**
```typescript
const results = await db
  .select({
    id: documents.id,
    name: documents.name,
    uploaderName: users.name,
  })
  .from(documents)
  .leftJoin(users, eq(documents.createdBy, users.id))
  .where(eq(documents.tenantId, tenantId));
```

### Transactions

**Old:**
```typescript
await transaction(async (client) => {
  await client.query('INSERT INTO ...');
  await client.query('UPDATE ...');
});
```

**New:**
```typescript
await db.transaction(async (tx) => {
  await tx.insert(documents).values({ ... });
  await tx.update(documents).set({ ... });
});
```

## Step 4: Update Routes

Replace imports:
```typescript
// Old
import { query, transaction } from '../database/connection';

// New
import { db } from '../database/db';
import { documents, users } from '../database/schema';
import { eq, and, desc } from 'drizzle-orm';
```

## Step 5: Use Helper Functions

Check `src/database/helpers.ts` for common operations:
- `findDocumentById()`
- `findDocumentWithMetadata()`
- `checkDuplicateChecksum()`
- `generateDocumentNumber()`
- `searchDocuments()`
- `getUserWithRoles()`

## Step 6: Update All Routes

1. **documents.ts** → Use `documents-drizzle.ts` as reference
2. **folders.ts** → Replace raw SQL with Drizzle
3. **users.ts** → Replace raw SQL with Drizzle
4. **admin.ts** → Replace raw SQL with Drizzle
5. **dashboard.ts** → Replace raw SQL with Drizzle
6. **workflow.ts** → Replace raw SQL with Drizzle

## Benefits

✅ **Type Safety** - TypeScript knows your schema  
✅ **IntelliSense** - Auto-completion in IDE  
✅ **Less Errors** - Compile-time checks  
✅ **Better Performance** - Optimized queries  
✅ **Neon Compatible** - Works with serverless Postgres  
✅ **Relations** - Easy joins and nested queries  

## Common Patterns

### Find with Relations
```typescript
const doc = await db.query.documents.findFirst({
  where: eq(documents.id, documentId),
  with: {
    folder: true,
    creator: true,
    versions: {
      orderBy: [desc(documentVersions.versionNumber)],
    },
  },
});
```

### Count Records
```typescript
import { count } from 'drizzle-orm';
const [{ count: total }] = await db
  .select({ count: count() })
  .from(documents)
  .where(eq(documents.tenantId, tenantId));
```

### Complex Where Conditions
```typescript
import { or, like, gte, lte } from 'drizzle-orm';

const results = await db.query.documents.findMany({
  where: and(
    eq(documents.tenantId, tenantId),
    or(
      like(documents.name, `%${query}%`),
      eq(documents.status, 'approved')
    ),
    gte(documents.createdAt, startDate),
    lte(documents.createdAt, endDate)
  ),
});
```

## Testing

After migration:
1. Run `npm run build` to check TypeScript errors
2. Test all API endpoints
3. Verify database operations work correctly
4. Check performance (should be same or better)

## Need Help?

- See `src/routes/documents-drizzle.ts` for complete example
- Check `src/database/helpers.ts` for reusable functions
- Read [Drizzle Docs](https://orm.drizzle.team/docs/overview)
