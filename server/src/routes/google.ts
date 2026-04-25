import { Router } from 'express';
import { env } from '../config/env.js';
import { deleteConnection, findConnection } from '../db/googleConnections.js';
import { fail, ok } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { z } from 'zod';
import {
  buildAuthUrl,
  exchangeAndStore,
  hashesEqual,
  hashNonce,
  isConfigured,
  listSheets,
  revokeConnection,
  verifyState,
} from '../services/google-sheets.js';
import { validate } from '../middleware/validate.js';

const NONCE_COOKIE = 'ss_google_oauth_nonce';
const NONCE_COOKIE_MAX_AGE_MS = 10 * 60 * 1000; // matches state expiry

export const googleRouter = Router();

googleRouter.get('/status', requireAuth, async (req, res) => {
  const conn = await findConnection(req.user!.id);
  res.status(200).json(
    ok({
      configured: isConfigured(),
      connected: Boolean(conn),
      email: conn?.connected_email ?? null,
      expires_at: conn?.token_expires_at?.toISOString() ?? null,
    }),
  );
});

googleRouter.get('/connect', requireAuth, (req, res) => {
  if (!isConfigured()) {
    res.status(400).json(fail('NOT_CONFIGURED', 'Google OAuth is not configured on this server'));
    return;
  }
  try {
    const { url, nonce } = buildAuthUrl(req.user!.id);
    // Bind the OAuth flow to THIS browser. Without this, a signed state alone
    // is a bearer token any attacker can mint → CSRF token-substitution.
    res.cookie(NONCE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.nodeEnv === 'production',
      maxAge: NONCE_COOKIE_MAX_AGE_MS,
      // Path scoped to the callback so the cookie isn't sent to unrelated routes.
      path: '/api/google',
    });
    res.status(200).json(ok({ url }));
  } catch (err) {
    res.status(500).json(fail('INTERNAL_ERROR', err instanceof Error ? err.message : 'Unknown error'));
  }
});

/**
 * OAuth callback. Google redirects the user's browser here; we exchange the
 * code and then redirect back to the client with a success/failure flag.
 */
googleRouter.get('/callback', async (req, res) => {
  const error = typeof req.query.error === 'string' ? req.query.error : null;
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const state = typeof req.query.state === 'string' ? req.query.state : '';

  const clientBase = env.appUrl.replace(/\/$/, '');
  if (error) {
    res.redirect(`${clientBase}/settings?google_error=${encodeURIComponent(error)}`);
    return;
  }
  if (!code) {
    res.redirect(`${clientBase}/settings?google_error=missing_code`);
    return;
  }
  const st = verifyState(state);
  if (!st.ok) {
    res.redirect(`${clientBase}/settings?google_error=${encodeURIComponent(st.error)}`);
    return;
  }
  // The nonce cookie set by /connect must match the hash baked into state.
  // Same-browser-only invariant — defeats the token-substitution CSRF where an
  // attacker tries to bind their state to a victim's Google grant.
  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies ?? {};
  const cookieNonce = cookies[NONCE_COOKIE];
  if (!cookieNonce || !hashesEqual(hashNonce(cookieNonce), st.nonceHash)) {
    res.clearCookie(NONCE_COOKIE, { path: '/api/google' });
    res.redirect(`${clientBase}/settings?google_error=state_mismatch`);
    return;
  }
  // One-shot: clear immediately so the cookie can't be replayed.
  res.clearCookie(NONCE_COOKIE, { path: '/api/google' });
  try {
    await exchangeAndStore(st.userId, code);
    res.redirect(`${clientBase}/settings?google_connected=1`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Token exchange failed';
    res.redirect(`${clientBase}/settings?google_error=${encodeURIComponent(msg)}`);
  }
});

googleRouter.delete('/disconnect', requireAuth, async (req, res) => {
  await revokeConnection(req.user!.id);
  await deleteConnection(req.user!.id);
  res.status(200).json(ok({ disconnected: true }));
});

const sheetsListQuery = z.object({ q: z.string().max(200).optional() });

googleRouter.get(
  '/sheets',
  requireAuth,
  validate(sheetsListQuery, 'query'),
  async (req, res) => {
    const conn = await findConnection(req.user!.id);
    if (!conn) {
      res.status(400).json(fail('NOT_CONNECTED', 'Google is not connected'));
      return;
    }
    try {
      const q = (req.query as { q?: string }).q;
      const sheets = await listSheets(req.user!.id, q);
      res.status(200).json(ok({ sheets }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to list sheets';
      res.status(502).json(fail('SHEETS_LIST_FAILED', message));
    }
  },
);
