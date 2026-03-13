# Quick Start Guide - Neon + Drizzle ORM

## ✅ Setup Complete!

Drizzle ORM और Neon PostgreSQL setup हो गया है। अब ये steps follow करें:

### 1. Install Dependencies (अगर नहीं किया)
```bash
cd dataflowbackend
npm install
```

### 2. Neon Connection String Setup

`.env` file में अपना Neon connection string add करें:

```env
DATABASE_URL=postgresql://user:password@host.neon.tech/dbname?sslmode=require
```

**Neon से connection string कैसे मिलेगा:**
1. [neon.tech](https://neon.tech) पर account बनाएं
2. New project create करें
3. Dashboard से connection string copy करें
4. `.env` file में paste करें

### 3. Push Schema to Database

```bash
npm run db:push
```

यह command आपके schema को Neon database में push करेगा।

**Note:** अगर error आए तो:
- Connection string verify करें
- SSL mode check करें (`?sslmode=require`)
- Neon project active है या नहीं check करें

### 4. Seed Initial Data

```bash
npm run seed
```

यह default tenant, roles, और admin user create करेगा:
- **Email:** `admin@docflow.com`
- **Password:** `admin123`

### 5. Start Server

```bash
npm run dev
```

Server `http://localhost:3001` पर चलेगा।

## Available Commands

```bash
# Push schema to database (development)
npm run db:push

# Generate migration files
npm run db:generate

# Open Drizzle Studio (database GUI)
npm run db:studio

# Seed database
npm run seed

# Start development server
npm run dev
```

## Troubleshooting

### Error: "connection is insecure"
- Connection string में `?sslmode=require` add करें
- या Neon dashboard से direct connection string use करें (pooled नहीं)

### Error: "DATABASE_URL is not set"
- `.env` file में `DATABASE_URL` verify करें
- File `.env` नाम से होनी चाहिए (`.env.example` नहीं)

### Error: "Table already exists"
- Schema पहले से exist कर रहा है
- `npm run db:push` safe है - existing tables को modify करेगा
- या manually SQL run करें: `psql $DATABASE_URL < src/database/schema.sql`

## Next Steps

1. ✅ Schema push हो गया
2. ✅ Data seed हो गया
3. ⏭️ Routes को Drizzle ORM पर migrate करें (optional)
4. ⏭️ Frontend को backend से connect करें

## Files Reference

- **Schema:** `src/database/schema.ts`
- **Connection:** `src/database/db.ts`
- **Helpers:** `src/database/helpers.ts`
- **Example Route:** `src/routes/documents-drizzle.ts`
- **Config:** `drizzle.config.ts`

## Support

- `NEON_SETUP.md` - Detailed setup guide
- `MIGRATION_TO_DRIZZLE.md` - How to migrate routes
- `DRIZZLE_SETUP_COMPLETE.md` - Complete summary

---

**Ready to go!** 🚀

`npm run db:push` run करें और schema को Neon में push करें।
