# Database Setup Instructions

## Quick Setup

The database tables need to be created before the application can work. You have two options:

### Option 1: Run SQL Schema (Recommended for Quick Start)

1. Connect to your Neon PostgreSQL database using any PostgreSQL client (pgAdmin, DBeaver, or Neon's SQL Editor)

2. Copy and execute the entire contents of `src/database/schema.sql`

3. Also run the folder permissions migration:
   ```sql
   -- Execute: src/database/migrations/create-folder-permissions-table.sql
   ```

### Option 2: Use Drizzle ORM (Recommended for Production)

```bash
cd dataflowbackend

# Push schema to database
npm run db:push

# This will create all tables automatically
```

### Option 3: Manual SQL Execution

If you have access to Neon SQL Editor or psql:

```bash
# Connect to Neon database
psql "your-database-url"

# Then run:
\i src/database/schema.sql
\i src/database/migrations/create-folder-permissions-table.sql
```

## Verify Tables Created

After setup, verify these tables exist:
- tenants
- users
- roles
- permissions
- role_permissions
- user_roles
- folders
- documents
- document_versions
- metadata_fields
- metadata_values
- search_index
- audit_logs
- notifications
- document_categories
- system_settings
- folder_permissions (new)
- login_attempts
- password_reset_tokens

## After Setup

Once tables are created, restart the backend server:

```bash
npm run dev
```

Then try registration/login again.
