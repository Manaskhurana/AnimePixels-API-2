import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env.JWT_SECRET_KEY || 'change-me-in-production';
const JWT_ALGORITHM = 'HS256';
const JWT_EXPIRE_MINUTES = parseInt(
  process.env.JWT_EXPIRE_MINUTES || '60'
);

export const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password';

export const ALLOWED_CATEGORIES = new Set([
  'naruto',
  'one_piece',
  'demon_slayer',
  'jujutsu_kaisen',
  'attack_on_titan',
  'dragon_ball',
  'my_hero_academia',
  'pokemon',
  'spy_x_family',
  'solo_leveling',
  'nature',
  'popular_anime',
]);

export function createJwtToken(data: Record<string, any>): string {
  const payload = {
    ...data,
    exp: Math.floor(Date.now() / 1000) + JWT_EXPIRE_MINUTES * 60,
  };
  return jwt.sign(payload, JWT_SECRET, { algorithm: JWT_ALGORITHM as any });
}

export interface AdminPayload extends Record<string, any> {
  sub: string;
  is_admin: boolean;
}

export function authenticateAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization header' });
      return;
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: [JWT_ALGORITHM as any],
    }) as AdminPayload;

    if (!decoded.is_admin) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    (req as any).admin = decoded;
    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Token expired' });
    } else {
      res.status(401).json({ error: 'Invalid token' });
    }
  }
}

export function validateCategory(category: string): string {
  const normalized = category.toLowerCase().replace(/\s+/g, '_');
  if (!ALLOWED_CATEGORIES.has(normalized)) {
    throw new Error(`Invalid category: ${category}`);
  }
  return normalized;
}
