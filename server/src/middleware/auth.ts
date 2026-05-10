import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt.js';
import { fail } from '../lib/response.js';
import { hashToken } from '../lib/tokens.js';
import { findActiveByHash, touchLastUsed } from '../db/personalAccessTokens.js';
import { findUserById } from '../db/users.js';

export const PAT_PREFIX = 'sst_';

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

/**
 * In-memory debounce for last_used_at writes. The auth middleware fires on
 * every request, so without a guard we'd write per-request — which both
 * thrashes the row and serialises behind the UPDATE. A 60s window is good
 * enough for "when was this token last used" without paying that cost.
 */
const LAST_USED_DEBOUNCE_MS = 60_000;
const lastTouchedAt = new Map<string, number>();

async function authenticatePat(token: string): Promise<AuthenticatedUser | null> {
  const row = await findActiveByHash(hashToken(token));
  if (!row) return null;
  const user = await findUserById(row.user_id);
  if (!user) return null;
  const now = Date.now();
  const previous = lastTouchedAt.get(row.id) ?? 0;
  if (now - previous >= LAST_USED_DEBOUNCE_MS) {
    lastTouchedAt.set(row.id, now);
    // Fire-and-forget: the user is already authenticated; failing this write
    // shouldn't fail the request.
    void touchLastUsed(row.id).catch(() => {});
  }
  return { id: user.id, email: user.email };
}

function authenticateJwt(token: string): AuthenticatedUser | null {
  try {
    const payload = verifyAccessToken(token);
    return { id: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Personal access tokens win when present — X-API-Key is the documented
  // header for automation, and it's the only way to send a PAT without
  // pretending to be a JWT.
  const apiKeyHeader = req.header('x-api-key');
  if (apiKeyHeader) {
    const user = await authenticatePat(apiKeyHeader);
    if (user) {
      req.user = user;
      next();
      return;
    }
    res.status(401).json(fail('UNAUTHORIZED', 'Invalid or revoked API key'));
    return;
  }

  const header = req.header('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json(fail('UNAUTHORIZED', 'Missing or malformed Authorization header'));
    return;
  }
  const presented = match[1]!;
  // Authorization: Bearer sst_... is also accepted, so the same token works
  // from both header forms.
  if (presented.startsWith(PAT_PREFIX)) {
    const user = await authenticatePat(presented);
    if (user) {
      req.user = user;
      next();
      return;
    }
    res.status(401).json(fail('UNAUTHORIZED', 'Invalid or revoked API key'));
    return;
  }
  const user = authenticateJwt(presented);
  if (!user) {
    res.status(401).json(fail('UNAUTHORIZED', 'Invalid or expired access token'));
    return;
  }
  req.user = user;
  next();
}
