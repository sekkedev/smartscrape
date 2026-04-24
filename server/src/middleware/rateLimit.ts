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

/** 5 requests per minute per IP. Auth-entry routes (login, register, forgot-password). */
export const authEntryLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
  skip,
});

/** 100 requests per minute per IP. Default for other API routes. */
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
  skip,
});
