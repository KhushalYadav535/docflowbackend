import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

// Check if using Neon PostgreSQL (use serverless driver) or regular PostgreSQL
const isNeon = process.env.DATABASE_URL && (
  process.env.DATABASE_URL.includes('neon.tech') ||
  process.env.DATABASE_URL.includes('neon.tech')
);

// Use DATABASE_URL if available (Neon PostgreSQL), otherwise use individual parameters
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL.replace(/[?&]channel_binding=[^&]*/g, ''), // Remove channel_binding parameter for pg driver
      ssl: isNeon ? { rejectUnauthorized: false } : undefined,
      max: 5, // Further reduced for Neon free tier (usually 1-5 connections)
      min: 0, // Don't maintain idle connections
      idleTimeoutMillis: 10000, // Reduced idle timeout (10 seconds)
      connectionTimeoutMillis: 30000, // Increased timeout for Neon (30 seconds)
      keepAlive: false, // Disable keepAlive for Neon serverless
      allowExitOnIdle: true, // Allow pool to close when idle
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'docflow_db',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', { error: err.message });
  // Don't exit process - let it recover
  // process.exit(-1);
});

// Log when new connection is established
pool.on('connect', () => {
  logger.info('Database connection established');
});

// Warmup: eagerly test the connection so the pool is ready before requests arrive
export async function warmupConnection(): Promise<void> {
  const maxRetries = 5;
  for (let i = 0; i < maxRetries; i++) {
    try {
      await pool.query('SELECT 1');
      logger.info('Database connection warmed up successfully');
      return;
    } catch (err) {
      logger.warn(`Database warmup attempt ${i + 1}/${maxRetries} failed`, { error: (err as Error).message });
      if (i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 2000)); // wait 2s before retry
      }
    }
  }
  logger.error('Database warmup failed after all retries - server will attempt lazy connect');
}

export async function getClient(): Promise<PoolClient> {
  const client = await pool.connect();
  return client;
}

export async function query(text: string, params?: any[], retries = 2): Promise<any> {
  const start = Date.now();
  let lastError: any;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await pool.query(text, params);
      const duration = Date.now() - start;
      logger.debug('Executed query', { text, duration, rows: res.rowCount });
      return res;
    } catch (error: any) {
      lastError = error;
      const errorMessage = error.message || String(error);
      
      // Retry on connection timeout or connection errors
      if (attempt < retries && (
        errorMessage.includes('timeout') ||
        errorMessage.includes('Connection terminated') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('ENOTFOUND')
      )) {
        const delay = (attempt + 1) * 1000; // Exponential backoff: 1s, 2s
        logger.warn(`Query retry ${attempt + 1}/${retries} after ${delay}ms`, { text: text.substring(0, 100) });
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      logger.error('Query error', { text: text.substring(0, 100), error: errorMessage });
      throw error;
    }
  }
  
  throw lastError;
}

export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export { pool };
