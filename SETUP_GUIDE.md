# DataFlow Backend Setup Guide

## Quick Start

### 1. Install Dependencies
```bash
cd dataflowbackend
npm install
```

### 2. Setup Database

Create PostgreSQL database:
```bash
createdb docflow_db
```

Or using psql:
```sql
CREATE DATABASE docflow_db;
```

### 3. Configure Environment

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Update `.env` with your settings:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=docflow_db
DB_USER=postgres
DB_PASSWORD=your_password

JWT_SECRET=your-super-secret-jwt-key
CORS_ORIGIN=http://localhost:3000
```

### 4. Initialize Database

Run the schema:
```bash
psql docflow_db < src/database/schema.sql
```

Or using psql:
```bash
psql -U postgres -d docflow_db -f src/database/schema.sql
```

### 5. Seed Initial Data

Create default tenant, roles, and admin user:
```bash
npm run seed
```

Default admin credentials:
- Email: `admin@docflow.com`
- Password: `admin123`

### 6. Start Server

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm run build
npm start
```

Server runs on `http://localhost:3001`

## API Integration with Frontend

Update frontend `.env`:
```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

## Project Structure

```
dataflowbackend/
├── src/
│   ├── server.ts              # Main server file
│   ├── database/
│   │   ├── connection.ts     # PostgreSQL connection pool
│   │   ├── schema.sql        # Database schema
│   │   └── seed.ts           # Initial data seeding
│   ├── middleware/
│   │   ├── auth.ts           # JWT authentication
│   │   └── errorHandler.ts   # Error handling
│   ├── routes/
│   │   ├── auth.ts           # Authentication routes
│   │   ├── documents.ts      # Document management
│   │   ├── folders.ts        # Folder management
│   │   ├── users.ts          # User management
│   │   ├── admin.ts          # Admin routes
│   │   ├── dashboard.ts      # Dashboard data
│   │   └── workflow.ts       # Approval workflow
│   ├── services/
│   │   ├── ocr.ts            # OCR text extraction
│   │   └── audit.ts          # Audit logging
│   └── utils/
│       ├── logger.ts         # Winston logger
│       └── fileUpload.ts     # Multer configuration
├── package.json
├── tsconfig.json
└── README.md
```

## Key Features Implemented

### ✅ Document Management
- Upload with duplicate detection (SHA256 checksum)
- File storage with tenant isolation
- Metadata management
- Version control
- Move documents between folders

### ✅ OCR Integration
- Automatic OCR on upload
- Manual OCR trigger for Admin
- OCR status tracking
- Text extraction from PDF and images
- Search index integration

### ✅ Authentication & Authorization
- JWT-based authentication
- Multi-tenant support
- Role-based access control (RBAC)
- Password hashing with bcrypt

### ✅ Search
- Full-text search with PostgreSQL
- Relevance ranking
- Advanced filters
- OCR text indexing

### ✅ Audit Logging
- All actions logged
- Immutable audit trail
- Filterable logs
- CSV export ready

### ✅ Workflow
- Document approval workflow
- Status transitions
- Rejection with comments
- Pending approvals list

## API Endpoints Summary

### Authentication
- `POST /api/auth/register` - Register user
- `POST /api/auth/login` - Login
- `POST /api/auth/forgot-password` - Password reset

### Documents
- `POST /api/documents/upload` - Upload document (with duplicate check)
- `GET /api/documents/:id` - Get document
- `GET /api/documents/:id/file` - Download file
- `GET /api/documents/search` - Search documents
- `PATCH /api/documents/:id/move` - Move document
- `GET /api/documents/:id/versions` - Get versions
- `POST /api/documents/:id/versions` - Upload version
- `POST /api/documents/:id/versions/:versionId/restore` - Restore version
- `POST /api/documents/:id/ocr/trigger` - Trigger OCR
- `GET /api/documents/:id/ocr/status` - Get OCR status

### Folders
- `GET /api/folders` - List folders
- `POST /api/folders` - Create folder
- `PATCH /api/folders/:id` - Update folder
- `DELETE /api/folders/:id` - Delete folder

### Users (Admin)
- `GET /api/users` - List users
- `POST /api/users` - Create user
- `PATCH /api/users/:id` - Update user
- `PATCH /api/users/:id/deactivate` - Deactivate user

### Admin
- `GET /api/admin/audit-logs` - Get audit logs
- `GET /api/admin/roles` - Get roles

### Dashboard
- `GET /api/dashboard/stats` - Get statistics
- `GET /api/dashboard/recent` - Recent documents
- `GET /api/dashboard/most-accessed` - Most accessed
- `GET /api/dashboard/activity` - Activity feed

### Workflow
- `POST /api/workflow/documents/:id/approval/submit` - Submit for approval
- `POST /api/workflow/documents/:id/approval/approve` - Approve
- `POST /api/workflow/documents/:id/approval/reject` - Reject
- `GET /api/workflow/documents/pending-approvals` - Pending approvals

## Testing

Test the API with curl:

```bash
# Health check
curl http://localhost:3001/health

# Register
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","password":"password123"}'

# Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@docflow.com","password":"admin123"}'

# Get documents (with token)
curl http://localhost:3001/api/documents/search?q=test \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Tenant-ID: default-tenant-id"
```

## Troubleshooting

### Database Connection Error
- Check PostgreSQL is running: `pg_isready`
- Verify credentials in `.env`
- Ensure database exists: `psql -l | grep docflow_db`

### OCR Not Working
- Ensure Tesseract.js dependencies are installed
- Check file paths are correct
- Review logs in `logs/combined.log`

### File Upload Fails
- Check `uploads/` directory exists and is writable
- Verify file size limits in `.env`
- Check allowed file types

## Next Steps

1. Connect frontend to backend API
2. Update frontend API client to use real endpoints
3. Test all features end-to-end
4. Deploy to production environment

## Support

For issues or questions, check:
- `README.md` for API documentation
- `src/database/schema.sql` for database structure
- Logs in `logs/` directory
