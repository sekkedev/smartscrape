import { useAuth } from '../stores/auth';
import type { ApiResponse, RefreshResponse } from '../types/api';

const NO_AUTO_REFRESH: RegExp[] = [/^\/api\/auth\/(login|register|refresh|forgot-password|reset-password|verify-email)/];

type RequestOptions = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  skipAuth?: boolean;
};

// Coalesce concurrent refreshes so one rotation serves every in-flight caller.
let refreshPromise: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  const { refreshToken } = useAuth.getState();
  if (!refreshToken) return false;

  refreshPromise = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      const json = (await res.json()) as ApiResponse<RefreshResponse>;
      if (!json.success) {
        useAuth.getState().clear();
        return false;
      }
      useAuth.getState().setSession(json.data);
      return true;
    } catch {
      useAuth.getState().clear();
      return false;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function doFetch(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!opts.skipAuth) {
    const { accessToken } = useAuth.getState();
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  }
  return fetch(path, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  let res = await doFetch(path, opts);

  if (res.status === 401 && !NO_AUTO_REFRESH.some((re) => re.test(path)) && !opts.skipAuth) {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await doFetch(path, opts);
    }
  }

  try {
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return {
      success: false,
      data: null,
      error: { code: 'NETWORK_ERROR', message: `Unexpected response (${res.status})` },
    };
  }
}

/** Convenience: throws if the envelope reports failure. Use when you don't need to branch on the error. */
export async function apiOrThrow<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const result = await api<T>(path, opts);
  if (!result.success) {
    const err = new Error(result.error.message);
    (err as Error & { code?: string }).code = result.error.code;
    throw err;
  }
  return result.data;
}
