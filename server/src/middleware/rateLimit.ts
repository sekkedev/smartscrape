import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { fail } from '../lib/response.js';

function handler(_req: Request, res: Response): void {
  res.status(429).json(fail('RATE_LIMITED', 'Too many requests, please try again later.'));
}

// Escape hatch for e2e tests. Opt-in via env so it never silently weakens
// production. Set SKIP_RATE_LIMIT=1 when running Playwright so the shared
// session fixture doesn't trip the auth-entry limiter.
const skip = (): boolean => process.env.SKIP_RATE_LIMIT === '1';

/**
 * Use the authenticated user's id as the rate-limit key when the request has
 * been through requireAuth, otherwise fall back to the IP. With `trust proxy
 * = 1` the IP is spoofable behind anything other than a single trusted proxy,
 * so for authenticated routes we strongly prefer the userId.
 *
 * IPv6 addresses are normalised by Express's `req.ip` already; we don't try
 * to bucket /64 subnets here because the per-IP limiter is a fallback for
 * unauth flows, not the primary defense once we have a userId.
 */
function userOrIp(req: Request): string {
  const userId = (req as Request & { user?: { id?: string } }).user?.id;
  if (userId) return `u:${userId}`;
  return `ip:${req.ip ?? 'unknown'}`;
}

/** 5 requests per minute per IP. Auth-entry routes (login, register, forgot-password). */
export const authEntryLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
  skip,
});

/** 100 requests per minute per IP. Default for other API routes (mounted before auth). */
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
  skip,
});

/** 100 requests per minute per authenticated user. Mount AFTER requireAuth. */
export const userGeneralLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userOrIp,
  handler,
  skip,
});

/** 10 requests per minute per user. AI setup wizard. */
export const aiSetupLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userOrIp,
  handler,
  skip,
});

/** 20 manual run triggers per hour per user (in addition to the 100/24h quota). */
export const runTriggerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userOrIp,
  handler,
  skip,
});

/** 10 manual Sheets pushes per minute per user — keeps Google's quota safe. */
export const sheetsPushLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userOrIp,
  handler,
  skip,
});
