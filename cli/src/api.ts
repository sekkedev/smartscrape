import { CliError, EXIT } from './output.js';
import { loadConfig, resolveSession, saveConfig, type ResolvedSession } from './config.js';
import type { ApiError, ApiResponse } from './types.js';

export type RequestOpts = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /**
   * If true, do not attempt the standard JWT refresh flow on 401. Used by
   * /auth/login itself and by /auth/refresh to avoid re-entrant loops.
   */
  noAutoRefresh?: boolean;
  /**
   * If true, return the raw Response so callers can read headers (Set-Cookie,
   * Content-Disposition) or non-JSON bodies (CSV).
   */
  raw?: boolean;
  /**
   * Extra headers to forward (mostly used for the refresh-cookie replay).
   */
  headers?: Record<string, string>;
};

export type ApiClient = {
  session: ResolvedSession;
  request: <T>(path: string, opts?: RequestOpts) => Promise<T>;
  requestRaw: (path: string, opts?: RequestOpts) => Promise<Response>;
};

function buildUrl(base: string, path: string, query?: RequestOpts['query']): string {
  const u = new URL(path.startsWith('/') ? path : `/${path}`, base);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

function statusToExit(status: number): number {
  if (status === 401 || status === 403) return EXIT.AUTH;
  if (status === 404) return EXIT.NOT_FOUND;
  if (status === 400 || status === 422) return EXIT.VALIDATION;
  return EXIT.ERROR;
}

function apiErrorToCli(status: number, err: ApiError | null, fallback: string): CliError {
  const message = err?.message ?? fallback;
  return new CliError(message, statusToExit(status), err?.code);
}

/**
 * Attempt the cookie-only refresh flow once and persist the new pair. Returns
 * the new access token on success, or null if refresh failed (caller should
 * surface the original 401).
 */
async function tryRefresh(session: ResolvedSession): Promise<string | null> {
  if (!session.refreshCookie) return null;
  const url = buildUrl(session.url, '/api/auth/refresh');
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: session.refreshCookie,
      },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const setCookie = res.headers.get('set-cookie');
  let body: ApiResponse<{ accessToken: string; refreshExpiresAt: string }>;
  try {
    body = (await res.json()) as ApiResponse<{ accessToken: string; refreshExpiresAt: string }>;
  } catch {
    return null;
  }
  if (!body.success) return null;
  const stored = loadConfig();
  stored.accessToken = body.data.accessToken;
  stored.refreshExpiresAt = body.data.refreshExpiresAt;
  if (setCookie) stored.refreshCookie = extractRefreshCookie(setCookie);
  saveConfig(stored);
  return body.data.accessToken;
}

/**
 * The server's Set-Cookie header looks like:
 *   refreshToken=...; Path=/; HttpOnly; SameSite=Strict; Expires=...
 * We only need the `name=value` pair to replay. Strip attributes.
 */
export function extractRefreshCookie(setCookieHeader: string): string | null {
  // Multiple Set-Cookie values can be comma-joined by some fetch implementations.
  // node:fetch concatenates them with ", " — but commas inside Expires dates
  // make naive splitting unsafe. Instead, find the refreshToken segment.
  const match = setCookieHeader.match(/refreshToken=[^;,\s]+/);
  return match ? match[0] : null;
}

export function createClient(overrides?: {
  url?: string;
  token?: string;
  apiKey?: string;
}): ApiClient {
  const session = resolveSession(overrides);

  async function doFetch(
    path: string,
    opts: RequestOpts = {},
    token: string | null,
  ): Promise<Response> {
    const url = buildUrl(session.url, path, opts.query);
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(opts.headers ?? {}),
    };
    // API key wins over JWT — headless callers configure SMARTSCRAPE_API_KEY
    // precisely to avoid the refresh dance, so we honor it whenever it's set.
    if (session.apiKey) headers['x-api-key'] = session.apiKey;
    else if (token) headers['authorization'] = `Bearer ${token}`;
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    return fetch(url, { method: opts.method ?? 'GET', headers, body });
  }

  async function requestRaw(path: string, opts: RequestOpts = {}): Promise<Response> {
    let token = session.token;
    let res = await doFetch(path, opts, token);
    // Don't refresh when authenticating via API key — those are long-lived and
    // either work or are revoked; there's no JWT to renew.
    if (res.status === 401 && !opts.noAutoRefresh && !session.apiKey && session.refreshCookie) {
      const refreshed = await tryRefresh(session);
      if (refreshed) {
        token = refreshed;
        session.token = refreshed;
        res = await doFetch(path, opts, token);
      }
    }
    return res;
  }

  async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
    const res = await requestRaw(path, opts);
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) {
      if (res.ok) {
        // Caller asked for JSON but server returned something else (e.g. CSV).
        // Force them to use raw mode.
        throw new CliError(
          `Expected JSON response from ${path} but received ${ct || 'unknown'}`,
          EXIT.ERROR,
        );
      }
      throw new CliError(`Request to ${path} failed: HTTP ${res.status}`, statusToExit(res.status));
    }
    let parsed: ApiResponse<T>;
    try {
      parsed = (await res.json()) as ApiResponse<T>;
    } catch {
      throw new CliError(`Invalid JSON from ${path}`, EXIT.ERROR);
    }
    if (!res.ok || !parsed.success) {
      throw apiErrorToCli(
        res.status,
        parsed.success === false ? parsed.error : null,
        `HTTP ${res.status}`,
      );
    }
    return parsed.data;
  }

  return { session, request, requestRaw };
}

export function requireToken(client: ApiClient): void {
  if (client.session.apiKey) return;
  if (!client.session.token) {
    throw new CliError(
      "Not signed in. Run 'smartscrape auth login', or set SMARTSCRAPE_API_KEY / SMARTSCRAPE_TOKEN.",
      EXIT.AUTH,
      'NO_TOKEN',
    );
  }
}
