import { Router, Request, Response } from 'express';
import { authenticateAdmin, createJwtToken, validateCategory, ALLOWED_CATEGORIES, ADMIN_USERNAME, ADMIN_PASSWORD } from '../lib/auth.js';
import { query, getConnection } from '../lib/db.js';
import { logger } from '../index.js';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import streamifier from 'streamifier';

const router = Router();
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed: ${allowedMimes.join(', ')}`));
    }
  }
});

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
}

interface MediaRecord {
  id: number;
  title: string;
  category: string;
  url: string;
  media_type: string;
  views: number;
  visible: boolean;
}

interface UploadedMediaItem {
  filename: string;
  title: string;
  category: string;
  media: MediaRecord;
}

interface UploadError {
  filename: string;
  index: number;
  error: string;
}

interface BulkUploadResponse {
  success: number;
  failed: number;
  uploaded_media: UploadedMediaItem[];
  errors: UploadError[];
}

interface UploadFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

// Helper function to normalize array fields from multipart/form-data
function normalizeArrayField(field: any): string[] {
  if (!field) return [];
  if (Array.isArray(field)) return field;
  if (typeof field === 'string') {
    // Try parsing as JSON first
    try {
      const parsed = JSON.parse(field);
      if (Array.isArray(parsed)) return parsed;
      return [field];
    } catch {
      return [field];
    }
  }
  return [];
}

// ---------- LOGIN ENDPOINT ----------
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password required' });
      return;
    }
    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const token = createJwtToken({
      sub: username,
      is_admin: true,
    });
    logger.info(`✓ Admin login successful for user: ${username}`);
    res.json({ token });
  } catch (error: any) {
    logger.error('Login error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ---------- INITIALIZE DATABASE ----------
router.get('/init-db', authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const conn = await getConnection();
    await conn.query(`
      CREATE TABLE IF NOT EXISTS media (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL,
        url TEXT NOT NULL,
        media_type VARCHAR(20) NOT NULL,
        views INT DEFAULT 0,
        visible BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_media_category ON media(category);
      CREATE INDEX IF NOT EXISTS idx_media_type ON media(media_type);
      CREATE INDEX IF NOT EXISTS idx_media_visible ON media(visible);
    `);
    conn.release();
    logger.info('✓ Database tables initialized');
    res.json({
      status: 'success',
      message: 'Database tables created successfully',
    });
  } catch (error: any) {
    logger.error('Init DB error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ---------- GET STATISTICS ----------
router.get('/stats', authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(`
      SELECT 
        COUNT(*) as total_media,
        SUM(CASE WHEN media_type = 'image' THEN 1 ELSE 0 END) as total_images,
        SUM(CASE WHEN media_type = 'gif' THEN 1 ELSE 0 END) as total_gifs,
        SUM(CASE WHEN visible = true THEN 1 ELSE 0 END) as visible_count,
        SUM(CASE WHEN visible = false THEN 1 ELSE 0 END) as hidden_count,
        SUM(views) as total_views
      FROM media
    `);
    const summary = result.rows[0];
    const categoryResult = await query(`
      SELECT 
        category,
        COUNT(*) as total,
        SUM(CASE WHEN media_type = 'image' THEN 1 ELSE 0 END) as images,
        SUM(CASE WHEN media_type = 'gif' THEN 1 ELSE 0 END) as gifs
      FROM media
      GROUP BY category
      ORDER BY category
    `);
    const byCategory: Record<string, any> = {};
    categoryResult.rows.forEach((row: any) => {
      byCategory[row.category] = {
        total: parseInt(row.total) || 0,
        images: parseInt(row.images) || 0,
        gifs: parseInt(row.gifs) || 0,
      };
    });
    res.json({
      status: 'ok',
      database: 'connected',
      summary: {
        total_media: parseInt(summary.total_media) || 0,
        total_images: parseInt(summary.total_images) || 0,
        total_gifs: parseInt(summary.total_gifs) || 0,
        visible: parseInt(summary.visible_count) || 0,
        hidden: parseInt(summary.hidden_count) || 0,
        total_views: parseInt(summary.total_views) || 0,
      },
      by_category: byCategory,
      allowed_categories: Array.from(ALLOWED_CATEGORIES),
    });
  } catch (error: any) {
    logger.error('Stats error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ---------- LIST TABLES ----------
router.get('/tables', authenticateAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(`
      SELECT 
        COUNT(*) as total_records,
        SUM(CASE WHEN media_type = 'image' THEN 1 ELSE 0 END) as images,
        SUM(CASE WHEN media_type = 'gif' THEN 1 ELSE 0 END) as gifs
      FROM media
    `);
    const row = result.rows[0];
    res.json({
      status: 'ok',
      tables: ['media'],
      media: {
        total_record: parseInt(row.total_records) || 0,
        images: parseInt(row.images) || 0,
        gifs: parseInt(row.gifs) || 0,
      },
    });
  } catch (error: any) {
    logger.error('Tables error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ---------- BULK UPLOAD ----------
router.post(
  '/bulk-upload',
  authenticateAdmin,
  upload.array('files', 100),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!cloudinary.config().cloud_name) {
        logger.error('Cloudinary configuration missing');
        res.status(500).json({ 
          error: 'Cloudinary is not configured',
          details: 'Missing CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, or CLOUDINARY_API_SECRET'
        });
        return;
      }

      const files = (req as any).files as UploadFile[] || [];
      
      // Normalize array fields - THIS IS THE KEY FIX
      let titles = normalizeArrayField(req.body.titles);
      let categories = normalizeArrayField(req.body.categories);
      const media_type = req.body.media_type;

      logger.info(`Request body received: titles=${JSON.stringify(req.body.titles)}, categories=${JSON.stringify(req.body.categories)}`);
      logger.info(`Normalized: titles.length=${titles.length}, categories.length=${categories.length}, files.length=${files.length}`);

      if (files.length === 0) {
        res.status(400).json({ error: 'No files provided' });
        return;
      }

      // If only one title/category provided, replicate it for all files
      if (titles.length === 1 && files.length > 1) {
        logger.info(`Single title provided for ${files.length} files - replicating`);
        const singleTitle = titles[0];
        titles = files.map((_, idx) => `${singleTitle} ${idx + 1}`);
      }

      if (categories.length === 1 && files.length > 1) {
        logger.info(`Single category provided for ${files.length} files - replicating`);
        const singleCategory = categories[0];
        categories = Array(files.length).fill(singleCategory);
      }

      // Validate array lengths
      if (titles.length !== files.length) {
        res.status(400).json({
          error: `Titles count (${titles.length}) != files count (${files.length})`,
          hint: 'Provide either one title for all files, or one title per file',
          received: {
            files: files.length,
            titles: titles.length,
            categories: categories.length
          }
        });
        return;
      }

      if (categories.length !== files.length) {
        res.status(400).json({
          error: `Categories count (${categories.length}) != files count (${files.length})`,
          hint: 'Provide either one category for all files, or one category per file',
          received: {
            files: files.length,
            titles: titles.length,
            categories: categories.length
          }
        });
        return;
      }

      if (!['image', 'gif'].includes(media_type)) {
        res.status(400).json({ error: "media_type must be 'image' or 'gif'" });
        return;
      }

      const uploadedMedia: UploadedMediaItem[] = [];
      const errors: UploadError[] = [];
      let successCount = 0;
      let failedCount = 0;

      logger.info(`Starting bulk upload: ${files.length} files, type=${media_type}`);

      for (let idx = 0; idx < files.length; idx++) {
        try {
          const file = files[idx];
          const title = String(titles[idx]).trim();
          let category = String(categories[idx]).trim();

          if (!title) {
            throw new Error('Title cannot be empty');
          }

          category = validateCategory(category);

          logger.info(`[${idx + 1}/${files.length}] Uploading: ${file.originalname} (${file.size} bytes) - Title: "${title}", Category: "${category}"`);

          const uploadParams: any = {
            resource_type: 'image',
            folder: `animepixels/${category}`,
            use_filename: true,
            unique_filename: true,
            timeout: 60000,
          };

          if (media_type === 'gif') {
            uploadParams.format = 'gif';
            uploadParams.flags = 'animated';
          }

          logger.info(`Upload params: resource_type=${uploadParams.resource_type}, folder=${uploadParams.folder}, format=${uploadParams.format || 'auto'}`);

          const uploadResult = await new Promise<any>((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              uploadParams,
              (error: any, result: any) => {
                if (error) {
                  logger.error(`Cloudinary upload error: ${error.message}`);
                  reject(error);
                } else {
                  resolve(result);
                }
              }
            );

            stream.on('error', (error: any) => {
              logger.error(`Stream error: ${error.message}`);
              reject(error);
            });

            streamifier.createReadStream(file.buffer).pipe(stream);
          });

          const secureUrl = uploadResult.secure_url;
          if (!secureUrl) {
            throw new Error('Cloudinary did not return secure_url');
          }

          logger.info(`✓ Cloudinary upload successful: ${secureUrl}`);

          const insertResult = await query(
            `INSERT INTO media (title, category, url, media_type, visible, views)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, title, category, url, media_type, views, visible`,
            [title, category, secureUrl, media_type, true, 0]
          );

          const mediaRecord: MediaRecord = insertResult.rows[0];
          logger.info(`✓ Database save successful: Media ID ${mediaRecord.id}`);

          const uploadedItem: UploadedMediaItem = {
            filename: file.originalname,
            title,
            category,
            media: mediaRecord,
          };

          uploadedMedia.push(uploadedItem);
          successCount++;
        } catch (error: any) {
          logger.error(`✗ Error uploading ${files[idx].originalname}:`, error.message);
          failedCount++;
          const errorItem: UploadError = {
            filename: files[idx].originalname,
            index: idx,
            error: error.message,
          };
          errors.push(errorItem);
        }
      }

      const response: BulkUploadResponse = {
        success: successCount,
        failed: failedCount,
        uploaded_media: uploadedMedia,
        errors,
      };

      logger.info(`✓ Bulk upload completed: ${successCount} succeeded, ${failedCount} failed`);
      res.json(response);
    } catch (error: any) {
      logger.error('Bulk upload error:', error.message);
      res.status(500).json({ 
        error: error.message,
        details: 'Check server logs for more information'
      });
    }
  }
);

export default router;
