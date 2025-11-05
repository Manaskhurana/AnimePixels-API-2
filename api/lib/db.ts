import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

let pool: pg.Pool | null = null;

function buildDatabaseUrl(url: string): string {
  if (!url) return url;
  if (!url.includes('sslmode')) {
    if (url.includes('?')) {
      return url + '&sslmode=require';
    } else {
      return url + '?sslmode=require';
    }
  }
  return url;
}

export async function initializeDatabase(): Promise<void> {
  if (pool) return;

  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable not set');
  }

  const finalUrl = buildDatabaseUrl(DATABASE_URL);
  console.log(`[DB] Connecting to database: ${finalUrl.substring(0, 60)}...`);

  pool = new pg.Pool({
    connectionString: finalUrl,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (err) => {
    console.error('[DB] Unexpected error on idle client', err);
  });
}

export async function getConnection(): Promise<pg.PoolClient> {
  if (!pool) {
    throw new Error('Database not initialized');
  }
  return pool.connect();
}

export async function createTables(): Promise<void> {
  const conn = await getConnection();
  try {
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
    console.log('[DB] Tables created successfully');
  } finally {
    conn.release();
  }
}

export async function query(
  text: string,
  params?: any[]
): Promise<pg.QueryResult> {
  const conn = await getConnection();
  try {
    return await conn.query(text, params);
  } finally {
    conn.release();
  }
}
