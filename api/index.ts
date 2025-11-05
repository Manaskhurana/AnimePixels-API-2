import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import path from 'path';
import { fileURLToPath } from 'url';

import { 
  initializeDatabase, 
  createTables, 
  getConnection 
} from './lib/db.js';
import mediaRoutes from './routes/media.js';
import adminRoutes from './routes/admin.js';

dotenv.config();

// ========== ENVIRONMENT DETECTION ==========
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
const IS_DEVELOPMENT = !IS_PRODUCTION;
const VERCEL_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';

// Setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Express = express();
export const PORT = process.env.PORT || 3000;

// ========== LOGGER SETUP ==========
export const logger = {
  info: (msg: string, ...args: any[]) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`, ...args),
};

logger.info(`🚀 Starting AnimePixels API...`);
logger.info(`📦 Environment: ${IS_PRODUCTION ? 'PRODUCTION (Vercel)' : 'DEVELOPMENT'}`);

// ========== CLOUDINARY SETUP ==========
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
    timeout: 60000,
  });
  logger.info('✓ Cloudinary configured');
} else {
  logger.warn('⚠ Cloudinary credentials not found in environment variables');
  logger.warn('  Required env vars: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET');
}

// ========== DATABASE INITIALIZATION FLAG ==========
let databaseInitialized = false;

// Initialize database only once
async function initializeDatabaseOnce(): Promise<void> {
  if (databaseInitialized) return;
  
  try {
    logger.info('💾 Initializing database...');
    await initializeDatabase();
    await createTables();
    databaseInitialized = true;
    logger.info('✓ Database initialized successfully');
  } catch (error: any) {
    logger.error('Database initialization error:', error.message);
    // Don't fail startup - allow API to run and retry on next request
  }
}

// ========== MIDDLEWARE ==========
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Request timeout middleware (important for Vercel)
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setTimeout(28000); // 28 seconds (Vercel limit is 30)
  next();
});

// ========== EXPORTS FOR ROUTE MODULES ==========
export { app, cloudinary };

// ========== HEALTH & STATUS ENDPOINTS ==========

app.get('/', (req: Request, res: Response) => {
  res.json({ 
    message: '✅ AnimePixels API is running!',
    version: '2.0.0',
  });
});

app.get('/favicon.ico', (req: Request, res: Response) => {
  res.status(204).send();
});

// Health check endpoint
app.get('/health', async (req: Request, res: Response): Promise<void> => {
  try {
    // Initialize database if not already done
    await initializeDatabaseOnce();

    const conn = await getConnection();
    const result = await conn.query(
      `SELECT 
        COUNT(*) as total_media, 
        SUM(CASE WHEN media_type = 'image' THEN 1 ELSE 0 END) as images, 
        SUM(CASE WHEN media_type = 'gif' THEN 1 ELSE 0 END) as gifs 
       FROM media`
    );
    conn.release();
    
    const row = result.rows[0];
    res.json({
      status: 'ok',
      database: 'connected',
      server: 'running',
      environment: IS_PRODUCTION ? 'production' : 'development',
      total_media: parseInt(row.total_media) || 0,
      images: parseInt(row.images) || 0,
      gifs: parseInt(row.gifs) || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Health check failed:', error.message);
    res.status(500).json({
      status: 'error',
      database: 'disconnected',
      server: 'running',
      environment: IS_PRODUCTION ? 'production' : 'development',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ========== API ROUTES ==========

// Middleware to ensure database is initialized before routes
app.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    await initializeDatabaseOnce();
    next();
  } catch (error: any) {
    logger.error('Database initialization middleware error:', error.message);
    next(); // Continue anyway
  }
});

// Admin routes
app.use('/api/admin', adminRoutes);

// Media routes
app.use('/api/media', mediaRoutes);

// ========== 404 HANDLER ==========

app.use((req: Request, res: Response) => {
  logger.warn(`404 Not Found: ${req.method} ${req.path}`);
  res.status(404).json({ 
    error: 'Not Found',
    path: req.path,
    method: req.method,
    environment: IS_PRODUCTION ? 'production' : 'development',
    available_endpoints: {
      status: 'GET /',
      health: 'GET /health',
      login: 'POST /api/admin/login',
      upload: 'POST /api/admin/bulk-upload',
      stats: 'GET /api/admin/stats (with Bearer token)',
      media: 'GET /api/media/random, /api/media/all-images, /api/media/search/image, etc.'
    }
  });
});

// ========== ERROR HANDLER ==========

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error:', err.message);
  logger.error('Stack:', err.stack);
  
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: IS_DEVELOPMENT ? err.message : 'An error occurred',
    timestamp: new Date().toISOString(),
    environment: IS_PRODUCTION ? 'production' : 'development',
  });
});

// ========== STARTUP FUNCTION (Development Only) ==========

async function startupDevelopment() {
  try {
    logger.info('🔧 Starting in DEVELOPMENT mode');
    logger.info(`📍 Listening on http://localhost:${PORT}`);

    // Initialize database
    await initializeDatabaseOnce();

    const server = app.listen(PORT, () => {
      logger.info(`✓ Server running on http://localhost:${PORT}`);
      logger.info('');
      logger.info('📚 Available endpoints:');
      logger.info('  GET  http://localhost:3000/');
      logger.info('  GET  http://localhost:3000/health');
      logger.info('  POST http://localhost:3000/api/admin/login');
      logger.info('  POST http://localhost:3000/api/admin/bulk-upload');
      logger.info('  GET  http://localhost:3000/api/admin/stats');
      logger.info('  GET  http://localhost:3000/api/media/all-images');
      logger.info('  GET  http://localhost:3000/api/media/all-gifs');
      logger.info('  GET  http://localhost:3000/api/media/random');
      logger.info('  GET  http://localhost:3000/api/media/search/image?q=dragon');
      logger.info('');
    });

    // Graceful shutdown
    const gracefulShutdown = () => {
      logger.info('Shutting down gracefully...');
      server.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

  } catch (error: any) {
    logger.error('💥 Startup failed:', error.message);
    logger.error(error.stack);
    process.exit(1);
  }
}

// ========== SERVER START ==========

// Start for local development
if (IS_DEVELOPMENT) {
  startupDevelopment().catch(error => {
    logger.error('Failed to start development server:', error.message);
    process.exit(1);
  });
} else {
  logger.info('🚀 Running on Vercel (Serverless)');
  logger.info(`📍 Public URL: ${VERCEL_URL}`);
}

// Export app for Vercel serverless and other environments
export default app;
