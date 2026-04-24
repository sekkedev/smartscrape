import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { fail } from '../lib/response.js';

function handler(_req: Request, res: Response): void {
  res.status(429).json(fail('RATE_LIMITED', 'Too many requests, please try again later.'));
}

/** 5 requests per minute per IP. Auth-entry routes (login, register, forgot-password). */
export const authEntryLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});

/** 100 requests per minute per IP. Default for other API routes. */
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});
