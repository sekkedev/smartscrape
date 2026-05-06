import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { fail } from '../lib/response.js';

/**
 * CSRF defense for cookie-authenticated state changes.
 *
 * CORS only controls whether the *response* is readable to JavaScript — a
 * cross-site form-encoded POST is a \"simple request\" that skips preflight,
 * so the request still reaches the route handler and side effects (revoke
 * session, rotate token, log out) execute regardless. We need to short-
 * circuit cross-site requests *before* the route runs.
 *
 * Two independent signals are checked:
 *
 *  - `Origin`: every browser-driven cross-origin request carries this.
 *    If present and not equal to `env.appUrl`, reject.
 *  - `Sec-Fetch-Site`: modern browsers add this metadata. If `cross-site`,
 *    reject. (Defense in depth alongside Origin — independent header,
 *    harder to lose simultaneously to a config drift or browser bug.)
 *
 * No headers present = server-to-server / curl / Playwright
 * `request.newContext()`. None of those can be CSRF-exploited (no automatic
 * cookie attachment from a victim's browser), so they pass through.
 *
 * `OPTIONS` preflight passes through; CORS owns that surface.
 */
export function requireSameSite(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'OPTIONS') {
    next();
    return;
  }

  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== '' && origin !== env.appUrl) {
    res.status(403).json(fail('FORBIDDEN_ORIGIN', `Origin not allowed: ${origin}`));
    return;
  }

  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite === 'cross-site') {
    res.status(403).json(fail('FORBIDDEN_SITE', 'Cross-site request blocked'));
    return;
  }

  next();
}
