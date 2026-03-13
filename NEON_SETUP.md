# Neon PostgreSQL Setup with Drizzle ORM

## Quick Start

### 1. Install Dependencies

```bash
cd dataflowbackend
npm install
```

This will install:
- `@neondatabase/serverless` - Neon serverless driver
- `drizzle-orm` - TypeScript ORM
- `drizzle-kit` - Migration tool
- `postgres` - PostgreSQL client

### 2. Configure Neon Database

1. Create account at [neon.tech](https://neon.tech)
2. Create a new project
3. Copy the connection string from Neon dashboard
4. Add to `.env`:

```env
DATABASE_URL=postgresql://user:password@host.neon.tech/dbname?sslmode=require
```

### 3. Generate Migrations

```bash
npm run db:generate
```

This creates migration files in `drizzle/` directory based on `src/database/schema.ts`

### 4. Push Schema to Neon

```bash
npm run db:push
```

This pushes the schema directly to your Neon database (great for development).

OR use migrations:

```bash
npm run db:migrate
```

### 5. Seed Initial Data

```bash
npm run seed
```

### 6. Start Development Server

```bash
npm run dev
```

## Database Schema

The schema is defined in `src/database/schema.ts` using Drizzle ORM.

### Key Tables:
- `tenants` - Multi-tenant organizations
- `users` - User accounts
- `roles` & `permissions` - RBAC
- `documents` - Document records
- `document_versions` - Version history
- `folders` - Folder hierarchy
- `metadata_fields` & `metadata_values` - Custom metadata
- `search_index` - Full-text search index
- `audit_logs` - Audit trail
- `notifications` - User notifications

## Using Drizzle ORM

### Query Examples

```typescript
import { db } from './database/db';
import { documents, users } from './database/schema';
import { eq, and, desc } from 'drizzle-orm';

// Find document with relations
const doc = await db.query.documents.findFirst({
  where: eq(documents.id, documentId),
  with: {
    folder: true,
    creator: true,
    versions: true,
  },
});

// Insert document
const [newDoc] = await db.insert(documents).values({
  tenantId: 'xxx',
  name: 'My Document',
  createdBy: userId,
}).returning();

// Update document
await db.update(documents)
  .set({ name: 'Updated Name' })
  .where(eq(documents.id, documentId));

// Complex query with joins
const results = await db
  .select({
    id: documents.id,
    name: documents.name,
    userName: users.name,
  })
  .from(documents)
  .leftJoin(users, eq(documents.createdBy, users.id))
  .where(eq(documents.tenantId, tenantId))
  .orderBy(desc(documents.createdAt));
```

## Migration Workflow

1. **Modify schema** in `src/database/schema.ts`
2. **Generate migration**: `npm run db:generate`
3. **Review** migration files in `drizzle/`
4. **Apply migration**: `npm run db:push` (dev) or `npm run db:migrate` (prod)

## Drizzle Studio (Database GUI)

View and edit your database:

```bash
npm run db:studio
```

Opens browser at `http://localhost:4983`

## Benefits of Drizzle ORM

✅ **Type-safe** - Full TypeScript support  
✅ **Fast** - Minimal overhead  
✅ **Flexible** - Use raw SQL when needed  
✅ **Relations** - Easy joins and nested queries  
✅ **Migrations** - Automatic schema generation  
✅ **Neon Compatible** - Works perfectly with serverless Postgres  

## Environment Variables

```env
# Required
DATABASE_URL=postgresql://user:password@host.neon.tech/dbname?sslmode=require

# Optional (for local development)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=docflow_db
DB_USER=postgres
DB_PASSWORD=postgres
```

## Troubleshooting

### Connection Issues
- Verify `DATABASE_URL` is correct
- Check Neon project is active
- Ensure SSL mode is set: `?sslmode=require`

### Migration Issues
- Delete `drizzle/` folder and regenerate
- Check schema syntax in `schema.ts`
- Verify database connection

### Type Errors
- Run `npm run build` to check TypeScript errors
- Ensure all imports are correct
- Check schema exports

## Next Steps

1. Update all routes to use Drizzle ORM (see `documents-drizzle.ts` example)
2. Replace `query()` calls with Drizzle queries
3. Use helper functions from `database/helpers.ts`
4. Test all endpoints
5. Deploy to production

## Resources

- [Drizzle ORM Docs](https://orm.drizzle.team/)
- [Neon Docs](https://neon.tech/docs)
- [Drizzle + Neon Guide](https://neon.tech/docs/serverless/drizzle)
