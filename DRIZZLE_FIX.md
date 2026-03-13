# Drizzle Kit Command Fix

## Issue
`drizzle-kit push` command not found - suggests `push:pg`

## Solution

### Option 1: Use push:pg (Recommended)
```bash
npm run db:push
```
This now runs `drizzle-kit push:pg`

### Option 2: Use generate + migrate
If `push:pg` doesn't work, use migrations instead:

```bash
# Generate migration files
npm run db:generate

# Then manually run SQL or use a migration tool
```

### Option 3: Direct SQL (Quick Setup)
If you need to set up quickly, you can run the SQL directly:

```bash
# Connect to Neon and run schema.sql
psql $DATABASE_URL < src/database/schema.sql
```

## Updated Config

The `drizzle.config.ts` has been updated to:
- Use `dialect: 'postgresql'` instead of `driver: 'pg'`
- Use `url` instead of `connectionString`
- Compatible with Neon PostgreSQL

## Try Now

```bash
npm run db:push
```

If it still doesn't work, try:
```bash
npx drizzle-kit push:pg
```

Or update drizzle-kit:
```bash
npm install drizzle-kit@latest
```
