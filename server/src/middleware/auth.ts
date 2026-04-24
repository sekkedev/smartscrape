import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt.js';
import { fail } from '../lib/response.js';

export type AuthenticatedUser = {
  id: string;
  email: string;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json(fail('UNAUTHORIZED', 'Missing or malformed Authorization header'));
    return;
  }
  try {
    const payload = verifyAccessToken(match[1]!);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    res.status(401).json(fail('UNAUTHORIZED', 'Invalid or expired access token'));
  }
}
