import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import { requireSecrets } from '../config/env.js';
import { decrypt, encrypt } from '../config/encryption.js';
import {
  findConnection,
  updateAccessToken,
  upsertConnection,
} from '../db/googleConnections.js';

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
export const DRIVE_METADATA_SCOPE = 'https://www.googleapis.com/auth/drive.metadata.readonly';
const USERINFO_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';

// write sheets + read drive metadata (so we can list the user's spreadsheets in the picker)
// + read the user's email to display which account is connected.
export const SHEETS_SCOPES = [SHEETS_SCOPE, DRIVE_METADATA_SCOPE, USERINFO_EMAIL_SCOPE];

const RECONNECT_HINT =
  'Disconnect Google in Settings and reconnect to grant the Sheets permission.';

function clientConfig() {
  const id = process.env.GOOGLE_CLIENT_ID ?? '';
  const secret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  const redirect = process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/api/google/callback';
  if (!id || !secret) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured');
  }
  return { id, secret, redirect };
}

export function isConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function oauthClient() {
  const c = clientConfig();
  return new google.auth.OAuth2(c.id, c.secret, c.redirect);
}

/**
 * Build the OAuth consent URL. State carries a short-lived signed token so the
 * callback can recover the initiating userId without session cookies.
 */
export function buildAuthUrl(userId: string): string {
  const { jwtAccessSecret } = requireSecrets();
  const state = jwt.sign({ sub: userId }, jwtAccessSecret, { expiresIn: '10m' });
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force refresh_token on re-auth
    scope: SHEETS_SCOPES,
    state,
  });
}

export type StateVerify = { ok: true; userId: string } | { ok: false; error: string };

export function verifyState(state: string): StateVerify {
  try {
    const { jwtAccessSecret } = requireSecrets();
    const payload = jwt.verify(state, jwtAccessSecret);
    if (typeof payload !== 'object' || !payload || !('sub' in payload)) {
      return { ok: false, error: 'Invalid state' };
    }
    return { ok: true, userId: String((payload as { sub: unknown }).sub) };
  } catch {
    return { ok: false, error: 'Invalid or expired state' };
  }
}

/** Exchange a callback code for tokens + the connected email, then persist. */
export async function exchangeAndStore(userId: string, code: string): Promise<{ email: string | null }> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) throw new Error('Google did not return an access token');

  const grantedScope = typeof tokens.scope === 'string' ? tokens.scope : '';
  const scopes = new Set(grantedScope.split(/\s+/).filter(Boolean));
  if (!scopes.has(SHEETS_SCOPE)) {
    throw new Error(
      `Google did not grant the Sheets scope (${SHEETS_SCOPE}). Granted: ${grantedScope || '(none)'}. ` +
        `Check the OAuth consent screen in the Google Cloud project and ensure spreadsheets is listed, then try again.`,
    );
  }

  if (!tokens.refresh_token) {
    // On re-auth Google omits refresh_token. If we already have one stored, reuse it.
    const existing = await findConnection(userId);
    if (!existing) {
      throw new Error('Google did not return a refresh_token; revoke app access in your Google account and retry.');
    }
    const existingRefresh = decrypt(existing.refresh_token_encrypted);
    tokens.refresh_token = existingRefresh;
  }

  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();
  const email = data.email ?? null;

  await upsertConnection({
    userId,
    accessTokenEncrypted: encrypt(tokens.access_token),
    refreshTokenEncrypted: encrypt(tokens.refresh_token),
    tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    connectedEmail: email,
    scope: grantedScope,
  });

  return { email };
}

/** Return an OAuth2 client with credentials set, refreshing the access token if near expiry. */
async function authedClient(userId: string) {
  const conn = await findConnection(userId);
  if (!conn) throw new Error('No Google connection');
  const client = oauthClient();
  const access = decrypt(conn.access_token_encrypted);
  const refresh = decrypt(conn.refresh_token_encrypted);
  client.setCredentials({
    access_token: access,
    refresh_token: refresh,
    expiry_date: conn.token_expires_at?.getTime(),
  });
  // Refresh if < 60s remaining.
  const now = Date.now();
  if (!conn.token_expires_at || conn.token_expires_at.getTime() - now < 60_000) {
    const { credentials } = await client.refreshAccessToken();
    if (credentials.access_token) {
      await updateAccessToken(
        userId,
        encrypt(credentials.access_token),
        credentials.expiry_date ? new Date(credentials.expiry_date) : new Date(now + 3600_000),
      );
      client.setCredentials({
        access_token: credentials.access_token,
        refresh_token: refresh,
        expiry_date: credentials.expiry_date,
      });
    }
  }
  return client;
}

/**
 * Append rows to {sheetId}!{tabName}. Writes a header row first if the tab is empty.
 * `rows` is a list of objects; the first row's keys define the column order.
 */
export async function pushRows(args: {
  userId: string;
  sheetId: string;
  tabName?: string | null;
  rows: Record<string, unknown>[];
}): Promise<{ appended: number }> {
  if (args.rows.length === 0) return { appended: 0 };
  // Fail fast with an actionable message when the stored scope is missing the
  // write permission. Otherwise the Sheets API returns an opaque 403.
  const conn = await findConnection(args.userId);
  if (conn && conn.scope !== null && !conn.scope.split(/\s+/).includes(SHEETS_SCOPE)) {
    throw new Error(
      `Stored Google credentials are missing the Sheets scope. ${RECONNECT_HINT}`,
    );
  }
  const client = await authedClient(args.userId);
  const sheets = google.sheets({ version: 'v4', auth: client });
  const tab = args.tabName && args.tabName.length > 0 ? args.tabName : 'Sheet1';
  const range = `${tab}!A:Z`;

  const headers = Object.keys(args.rows[0]!);

  // Check if the tab has any rows yet; write a header row if empty.
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: args.sheetId,
    range: `${tab}!A1:Z1`,
  });
  const hasHeader = Boolean(existing.data.values?.[0]?.length);

  const values: string[][] = [];
  if (!hasHeader) values.push(headers);
  for (const row of args.rows) {
    values.push(
      headers.map((h) => {
        const v = row[h];
        if (v === null || v === undefined) return '';
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
      }),
    );
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: args.sheetId,
    range,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });

  return { appended: args.rows.length };
}

export type SheetSummary = {
  id: string;
  name: string;
  modifiedTime: string | null;
  webViewLink: string | null;
};

/**
 * List the user's Google Sheets via Drive API. Requires the `drive.metadata.readonly`
 * scope. If the stored connection lacks it, throws a clear reconnect error so the UI
 * can surface a "reconnect Google" CTA instead of an opaque 403.
 */
export async function listSheets(userId: string, query?: string): Promise<SheetSummary[]> {
  const conn = await findConnection(userId);
  if (!conn) throw new Error('No Google connection');
  if (conn.scope !== null && !conn.scope.split(/\s+/).includes(DRIVE_METADATA_SCOPE)) {
    throw new Error(
      `Stored Google credentials are missing the Drive metadata scope. ${RECONNECT_HINT}`,
    );
  }
  const client = await authedClient(userId);
  const drive = google.drive({ version: 'v3', auth: client });
  const q = ["mimeType = 'application/vnd.google-apps.spreadsheet'", 'trashed = false'];
  if (query && query.trim().length > 0) {
    // escape single quotes for the Drive query string
    q.push(`name contains '${query.replace(/'/g, "\\'")}'`);
  }
  const { data } = await drive.files.list({
    q: q.join(' and '),
    pageSize: 50,
    orderBy: 'modifiedTime desc',
    fields: 'files(id, name, modifiedTime, webViewLink)',
  });
  return (data.files ?? []).map((f) => ({
    id: f.id ?? '',
    name: f.name ?? '(untitled)',
    modifiedTime: f.modifiedTime ?? null,
    webViewLink: f.webViewLink ?? null,
  }));
}

export async function revokeConnection(userId: string): Promise<void> {
  const conn = await findConnection(userId);
  if (!conn) return;
  try {
    const client = oauthClient();
    const token = decrypt(conn.access_token_encrypted);
    await client.revokeToken(token).catch(() => undefined);
  } catch {
    // best effort; we still delete the DB row.
  }
}
