# DataFlow Backend API

Document Management System Backend API built with Node.js, Express, TypeScript, and PostgreSQL.

## Features

- ✅ Multi-tenant architecture
- ✅ Role-based access control (RBAC)
- ✅ Document upload and management
- ✅ OCR text extraction (Tesseract.js)
- ✅ Full-text search
- ✅ Version control
- ✅ Audit logging
- ✅ Document approval workflow
- ✅ Folder management
- ✅ User management

## Setup

### Prerequisites

- Node.js 18+
- Neon PostgreSQL account (or local PostgreSQL)
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file from `.env.example`:
```bash
cp .env.example .env
```

3. Get Neon connection string:
   - Sign up at [neon.tech](https://neon.tech)
   - Create a new project
   - Copy connection string
   - Add to `.env` as `DATABASE_URL`

4. Push schema to database:
```bash
npm run db:push
```

5. Seed initial data:
```bash
npm run seed
```

**Default admin credentials:**
- Email: `admin@docflow.com`
- Password: `admin123`

### Development

Start development server:
```bash
npm run dev
```

Server will run on `http://localhost:3001`

### Production

Build:
```bash
npm run build
```

Start:
```bash
npm start
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/forgot-password` - Request password reset

### Documents
- `POST /api/documents/upload` - Upload document
- `GET /api/documents/:id` - Get document details
- `GET /api/documents/:id/file` - Download document file
- `GET /api/documents/search` - Search documents
- `PATCH /api/documents/:id/move` - Move document to folder
- `GET /api/documents/:id/versions` - Get version history
- `POST /api/documents/:id/versions` - Upload new version
- `POST /api/documents/:id/versions/:versionId/restore` - Restore version
- `POST /api/documents/:id/ocr/trigger` - Trigger OCR manually
- `GET /api/documents/:id/ocr/status` - Get OCR status

### Folders
- `GET /api/folders` - List folders
- `POST /api/folders` - Create folder
- `PATCH /api/folders/:id` - Update folder
- `DELETE /api/folders/:id` - Delete folder

### Users (Admin only)
- `GET /api/users` - List users
- `POST /api/users` - Create user
- `PATCH /api/users/:id` - Update user
- `PATCH /api/users/:id/deactivate` - Deactivate user

### Admin
- `GET /api/admin/audit-logs` - Get audit logs
- `GET /api/admin/roles` - Get roles

### Dashboard
- `GET /api/dashboard/stats` - Get statistics
- `GET /api/dashboard/recent` - Get recent documents
- `GET /api/dashboard/most-accessed` - Get most accessed documents
- `GET /api/dashboard/activity` - Get activity feed

### Workflow
- `POST /api/workflow/documents/:id/approval/submit` - Submit for approval
- `POST /api/workflow/documents/:id/approval/approve` - Approve document
- `POST /api/workflow/documents/:id/approval/reject` - Reject document
- `GET /api/workflow/documents/pending-approvals` - Get pending approvals

## Authentication

All protected routes require a JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

Also include tenant ID in header:
```
X-Tenant-ID: <tenant-id>
```

## Environment Variables

See `.env.example` for all available configuration options.

## Database Schema

The schema is defined using **Drizzle ORM** in `src/database/schema.ts`.

### Using Drizzle ORM

- **Type-safe** queries with full TypeScript support
- **Automatic migrations** with `npm run db:generate`
- **Database GUI** with `npm run db:studio`
- **Neon compatible** - Works perfectly with serverless Postgres

See `NEON_SETUP.md` for detailed setup instructions.

## License

MIT
