import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import { authenticateToken } from './middleware/auth';
import { initializeEmailService } from './services/emailService';
import { warmupConnection } from './database/connection';

// Routes
import authRoutes from './routes/auth';
import documentRoutes from './routes/documents';
import folderRoutes from './routes/folders';
import userRoutes from './routes/users';
import adminRoutes from './routes/admin';
import dashboardRoutes from './routes/dashboard';
import workflowRoutes from './routes/workflow';
import metadataRoutes from './routes/metadata';
import categoryRoutes from './routes/categories';
import notificationRoutes from './routes/notifications';
import storageRoutes from './routes/storage';
import tenantRoutes from './routes/tenants';

dotenv.config();

// Initialize email service
initializeEmailService();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
const allowedOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',').map((origin: string) => origin.trim())
  : ['http://localhost:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    tenantId: req.headers['x-tenant-id'],
  });
  next();
});

// Health check
app.get('/health', async (req, res) => {
  try {
    const { query } = await import('./database/connection');
    await query('SELECT 1');
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      database: 'connected'
    });
  } catch (error: any) {
    res.status(503).json({ 
      status: 'error', 
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error.message
    });
  }
});

// Public routes
app.use('/api/auth', authRoutes);

// Protected routes
app.use('/api/documents', authenticateToken, documentRoutes);
app.use('/api/folders', authenticateToken, folderRoutes);
app.use('/api/users', authenticateToken, userRoutes);
app.use('/api/admin', authenticateToken, adminRoutes);
app.use('/api/dashboard', authenticateToken, dashboardRoutes);
app.use('/api/workflow', authenticateToken, workflowRoutes);
app.use('/api/metadata-fields', authenticateToken, metadataRoutes);
app.use('/api/categories', authenticateToken, categoryRoutes);
app.use('/api/notifications', authenticateToken, notificationRoutes);
app.use('/api/storage', authenticateToken, storageRoutes);
app.use('/api/tenants', authenticateToken, tenantRoutes);

// Error handling
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Warmup DB connection before accepting requests
warmupConnection().then(() => {
  app.listen(PORT, () => {
    logger.info(`🚀 Server running on port ${PORT}`);
    logger.info(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}).catch(() => {
  // Start server anyway even if warmup fails - lazy connect will handle it
  app.listen(PORT, () => {
    logger.info(`🚀 Server running on port ${PORT} (DB warmup failed, using lazy connect)`);
  });
});

export default app;
