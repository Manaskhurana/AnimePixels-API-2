import { Router, Request, Response } from 'express';
import { query as dbQuery } from '../lib/db.js';
import { validateCategory } from '../lib/auth.js';
import { logger } from '../index.js';


const router = Router();


// Constants for pagination and limits
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const SEARCH_LIMIT = 100;


// Helper function to parse and validate limit query parameter
const getLimit = (limitParam: any): number => {
  const limit = parseInt(limitParam) || DEFAULT_LIMIT;
  return Math.min(Math.max(1, limit), MAX_LIMIT);
};


// Helper function to parse and validate offset query parameter
const getOffset = (offsetParam: any): number => {
  const offset = parseInt(offsetParam) || 0;
  return Math.max(0, offset);
};


// Helper function to validate search query string
const validateSearchQuery = (searchQuery: string): string => {
  if (!searchQuery || typeof searchQuery !== 'string') {
    throw new Error('Search query is required');
  }

  const trimmed = searchQuery.trim();
  if (trimmed.length === 0) {
    throw new Error('Search query cannot be empty');
  }

  if (trimmed.length > 255) {
    throw new Error('Search query too long (max 255 characters)');
  }

  return trimmed;
};


// Helper function to increment views safely
const incrementViews = async (mediaId: number): Promise<void> => {
  try {
    await dbQuery(
      'UPDATE media SET views = views + 1 WHERE id = $1',
      [mediaId]
    );
  } catch (error: any) {
    logger.warn(`Failed to increment views for media ${mediaId}:`, error.message);
  }
};


// ---------- GET ALL IMAGES & GIFS ----------

// Get all images across all categories
router.get('/all-images', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = getLimit(req.query.limit);
    const offset = getOffset(req.query.offset);

    const result = await dbQuery(
      `SELECT * FROM media 
       WHERE media_type = 'image' AND visible = true
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    // Get total count for pagination info
    const countResult = await dbQuery(
      `SELECT COUNT(*) as total FROM media 
       WHERE media_type = 'image' AND visible = true`
    );

    const total = parseInt(countResult.rows[0].total) || 0;

    if (result.rows.length === 0) {
      res.status(404).json({
        error: 'No images available',
        total: 0,
        returned: 0,
        limit,
        offset,
        results: []
      });
      return;
    }

    res.json({
      media_type: 'image',
      total,
      returned: result.rows.length,
      limit,
      offset,
      results: result.rows
    });
  } catch (error: any) {
    logger.error('Get all images error:', error.message);
    res.status(500).json({ error: error.message });
  }
});


// Get all GIFs across all categories
router.get('/all-gifs', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = getLimit(req.query.limit);
    const offset = getOffset(req.query.offset);

    const result = await dbQuery(
      `SELECT * FROM media 
       WHERE media_type = 'gif' AND visible = true
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    // Get total count for pagination info
    const countResult = await dbQuery(
      `SELECT COUNT(*) as total FROM media 
       WHERE media_type = 'gif' AND visible = true`
    );

    const total = parseInt(countResult.rows[0].total) || 0;

    if (result.rows.length === 0) {
      res.status(404).json({
        error: 'No gifs available',
        total: 0,
        returned: 0,
        limit,
        offset,
        results: []
      });
      return;
    }

    res.json({
      media_type: 'gif',
      total,
      returned: result.rows.length,
      limit,
      offset,
      results: result.rows
    });
  } catch (error: any) {
    logger.error('Get all gifs error:', error.message);
    res.status(500).json({ error: error.message });
  }
});


// ---------- RANDOM MEDIA ENDPOINTS ----------

// Random media (any)
router.get('/random', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await dbQuery(
      'SELECT * FROM media WHERE visible = true ORDER BY RANDOM() LIMIT 1'
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'No media available' });
      return;
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    logger.error('Random media error:', error.message);
    res.status(500).json({ error: error.message });
  }
});


// Random image (global)
router.get('/random/image', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await dbQuery(
      `SELECT * FROM media 
       WHERE media_type = 'image' AND visible = true 
       ORDER BY RANDOM() LIMIT 1`
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'No images available' });
      return;
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    logger.error('Random image error:', error.message);
    res.status(500).json({ error: error.message });
  }
});


// Random GIF (global)
router.get('/random/gif', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await dbQuery(
      `SELECT * FROM media 
       WHERE media_type = 'gif' AND visible = true 
       ORDER BY RANDOM() LIMIT 1`
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'No gifs available' });
      return;
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    logger.error('Random gif error:', error.message);
    res.status(500).json({ error: error.message });
  }
});


// Random image by category
router.get('/random/image/:category', async (req: Request, res: Response): Promise<void> => {
  try {
    const category = validateCategory(req.params.category);
    const result = await dbQuery(
      `SELECT * FROM media 
       WHERE category = $1 AND media_type = 'image' AND visible = true 
       ORDER BY RANDOM() LIMIT 1`,
      [category]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'No images in this category' });
      return;
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    if (error.message.startsWith('Invalid category')) {
      res.status(400).json({ error: error.message });
    } else {
      logger.error('Random image by category error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }
});


// Random GIF by category
router.get('/random/gif/:category', async (req: Request, res: Response): Promise<void> => {
  try {
    const category = validateCategory(req.params.category);
    const result = await dbQuery(
      `SELECT * FROM media 
       WHERE category = $1 AND media_type = 'gif' AND visible = true 
       ORDER BY RANDOM() LIMIT 1`,
      [category]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'No gifs in this category' });
      return;
    }

    res.json(result.rows[0]);
  } catch (error: any) {
    if (error.message.startsWith('Invalid category')) {
      res.status(400).json({ error: error.message });
    } else {
      logger.error('Random gif by category error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }
});


// ---------- GET BY ID ENDPOINTS ----------

// Get image by ID
router.get('/image/id/:media_id', async (req: Request, res: Response): Promise<void> => {
  try {
    const mediaId = parseInt(req.params.media_id);

    if (isNaN(mediaId) || mediaId < 1) {
      res.status(400).json({ error: 'Invalid media ID' });
      return;
    }

    const result = await dbQuery(
      `SELECT * FROM media 
       WHERE id = $1 AND visible = true AND media_type = 'image'`,
      [mediaId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    const media = result.rows[0];

    incrementViews(mediaId);

    res.json(media);
  } catch (error: any) {
    logger.error('Get image by ID error:', error.message);
    res.status(500).json({ error: error.message });
  }
});


// Get GIF by ID
router.get('/gif/id/:media_id', async (req: Request, res: Response): Promise<void> => {
  try {
    const mediaId = parseInt(req.params.media_id);

    if (isNaN(mediaId) || mediaId < 1) {
      res.status(400).json({ error: 'Invalid media ID' });
      return;
    }

    const result = await dbQuery(
      `SELECT * FROM media 
       WHERE id = $1 AND visible = true AND media_type = 'gif'`,
      [mediaId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'GIF not found' });
      return;
    }

    const media = result.rows[0];

    incrementViews(mediaId);

    res.json(media);
  } catch (error: any) {
    logger.error('Get GIF by ID error:', error.message);
    res.status(500).json({ error: error.message });
  }
});


// ---------- SEARCH ENDPOINTS ----------

// Search images
router.get('/search/image', async (req: Request, res: Response): Promise<void> => {
  try {
    const searchQuery = validateSearchQuery(req.query.q as string);
    const limit = getLimit(req.query.limit);
    const offset = getOffset(req.query.offset);

    const searchPattern = `%${searchQuery.toLowerCase()}%`;

    const result = await dbQuery(
      `SELECT * FROM media 
       WHERE visible = true AND media_type = 'image'
       AND (LOWER(title) LIKE $1 OR LOWER(category) LIKE $1)
       ORDER BY views DESC
       LIMIT $2 OFFSET $3`,
      [searchPattern, Math.min(limit, SEARCH_LIMIT), offset]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ 
        error: 'No images found',
        query: searchQuery,
        total: 0,
        results: []
      });
      return;
    }

    const countResult = await dbQuery(
      `SELECT COUNT(*) as total FROM media 
       WHERE visible = true AND media_type = 'image'
       AND (LOWER(title) LIKE $1 OR LOWER(category) LIKE $1)`,
      [searchPattern]
    );

    const total = parseInt(countResult.rows[0].total) || 0;

    res.json({
      query: searchQuery,
      total,
      returned: result.rows.length,
      limit: Math.min(limit, SEARCH_LIMIT),
      offset,
      results: result.rows
    });
  } catch (error: any) {
    if (error.message.includes('Search query')) {
      res.status(400).json({ error: error.message });
    } else {
      logger.error('Search images error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }
});


// Search GIFs
router.get('/search/gif', async (req: Request, res: Response): Promise<void> => {
  try {
    const searchQuery = validateSearchQuery(req.query.q as string);
    const limit = getLimit(req.query.limit);
    const offset = getOffset(req.query.offset);

    const searchPattern = `%${searchQuery.toLowerCase()}%`;

    const result = await dbQuery(
      `SELECT * FROM media 
       WHERE visible = true AND media_type = 'gif'
       AND (LOWER(title) LIKE $1 OR LOWER(category) LIKE $1)
       ORDER BY views DESC
       LIMIT $2 OFFSET $3`,
      [searchPattern, Math.min(limit, SEARCH_LIMIT), offset]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ 
        error: 'No gifs found',
        query: searchQuery,
        total: 0,
        results: []
      });
      return;
    }

    const countResult = await dbQuery(
      `SELECT COUNT(*) as total FROM media 
       WHERE visible = true AND media_type = 'gif'
       AND (LOWER(title) LIKE $1 OR LOWER(category) LIKE $1)`,
      [searchPattern]
    );

    const total = parseInt(countResult.rows[0].total) || 0;

    res.json({
      query: searchQuery,
      total,
      returned: result.rows.length,
      limit: Math.min(limit, SEARCH_LIMIT),
      offset,
      results: result.rows
    });
  } catch (error: any) {
    if (error.message.includes('Search query')) {
      res.status(400).json({ error: error.message });
    } else {
      logger.error('Search gifs error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }
});


// ---------- GET BY CATEGORY ENDPOINTS ----------

// Get images by category
router.get('/image/:category', async (req: Request, res: Response): Promise<void> => {
  try {
    const category = validateCategory(req.params.category);
    const limit = getLimit(req.query.limit);
    const offset = getOffset(req.query.offset);

    const result = await dbQuery(
      `SELECT * FROM media 
       WHERE category = $1 AND media_type = 'image' AND visible = true
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [category, limit, offset]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ 
        error: 'No images in this category',
        category,
        total: 0,
        results: []
      });
      return;
    }

    const countResult = await dbQuery(
      `SELECT COUNT(*) as total FROM media 
       WHERE category = $1 AND media_type = 'image' AND visible = true`,
      [category]
    );

    const total = parseInt(countResult.rows[0].total) || 0;

    res.json({
      category,
      total,
      returned: result.rows.length,
      limit,
      offset,
      results: result.rows
    });
  } catch (error: any) {
    if (error.message.startsWith('Invalid category')) {
      res.status(400).json({ error: error.message });
    } else {
      logger.error('Get images by category error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }
});


// Get GIFs by category
router.get('/gif/:category', async (req: Request, res: Response): Promise<void> => {
  try {
    const category = validateCategory(req.params.category);
    const limit = getLimit(req.query.limit);
    const offset = getOffset(req.query.offset);

    const result = await dbQuery(
      `SELECT * FROM media 
       WHERE category = $1 AND media_type = 'gif' AND visible = true
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [category, limit, offset]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ 
        error: 'No gifs in this category',
        category,
        total: 0,
        results: []
      });
      return;
    }

    const countResult = await dbQuery(
      `SELECT COUNT(*) as total FROM media 
       WHERE category = $1 AND media_type = 'gif' AND visible = true`,
      [category]
    );

    const total = parseInt(countResult.rows[0].total) || 0;

    res.json({
      category,
      total,
      returned: result.rows.length,
      limit,
      offset,
      results: result.rows
    });
  } catch (error: any) {
    if (error.message.startsWith('Invalid category')) {
      res.status(400).json({ error: error.message });
    } else {
      logger.error('Get gifs by category error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }
});


export default router;
