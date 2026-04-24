import { Router } from 'express';
import { env } from '../config/env.js';
import { deleteConnection, findConnection } from '../db/googleConnections.js';
import { fail, ok } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import {
  buildAuthUrl,
  exchangeAndStore,
  isConfigured,
  revokeConnection,
  verifyState,
} from '../services/google-sheets.js';

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
    const url = buildAuthUrl(req.user!.id);
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
