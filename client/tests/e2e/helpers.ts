import { test as base, type APIRequestContext, type Cookie, type Page } from '@playwright/test';

export const API_BASE = 'http://localhost:3000';

export type Session = {
  email: string;
  password: string;
  accessToken: string;
  /** ISO timestamp from the login response — drives RequireAuth's staleness gate. */
  refreshExpiresAt: string;
  /**
   * Cookies captured from the request context that performed the login,
   * including the HttpOnly `refreshToken` set by the server. Replayed into
   * the browser context by `primeAuth` so /api/auth/refresh works in tests
   * that exercise it.
   */
  cookies: Cookie[];
  userId: string;
};

/** Retry a request when the server returns 429 (auth-entry rate limit). */
async function postWithRateLimitRetry(
  request: APIRequestContext,
  url: string,
  data: unknown,
): Promise<ReturnType<APIRequestContext['post']> extends Promise<infer T> ? T : never> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await request.post(url, { data });
    if (res.status() !== 429) return res;
    // 15s — long enough that a fresh 60s window has a real chance of opening,
    // short enough that a full test suite still completes in reasonable time.
    await new Promise((r) => setTimeout(r, 15_000));
  }
  throw new Error(
    `exhausted rate-limit retries for ${url}. Restart the server with SKIP_RATE_LIMIT=1.`,
  );
}

export async function registerAndLogin(request: APIRequestContext): Promise<Session> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@local.test`;
  const password = 'PlayTest1234!';
  await postWithRateLimitRetry(request, `${API_BASE}/api/auth/register`, {
    email,
    password,
    name: 'E2E User',
  });
  const login = await postWithRateLimitRetry(request, `${API_BASE}/api/auth/login`, {
    email,
    password,
  });
  if (!login.ok()) {
    throw new Error(`login failed: ${login.status()} ${await login.text()}`);
  }
  const body = (await login.json()) as {
    data: { accessToken: string; refreshExpiresAt: string; user: { id: string } };
  };
  // Capture the cookies that the request context received from /login —
  // includes the HttpOnly `refreshToken` we'll replay into the browser
  // context via primeAuth so /api/auth/refresh works in tests.
  const storage = await request.storageState();
  return {
    email,
    password,
    accessToken: body.data.accessToken,
    refreshExpiresAt: body.data.refreshExpiresAt,
    cookies: storage.cookies,
    userId: body.data.user.id,
  };
}

/**
 * Worker-scoped fixture: one user per test worker. Tests share this session
 * so we stay under the auth-entry rate limit (5/min/IP) without needing a
 * test-only bypass in the server.
 *
 * When a test genuinely needs a pristine no-data user (empty-state assertions),
 * use `freshSession` which registers a fresh user on demand.
 */
export const test = base.extend<
  {
    freshSession: Session;
  },
  {
    sharedSession: Session;
  }
>({
  sharedSession: [
    async ({ playwright }, use) => {
      const ctx = await playwright.request.newContext();
      const session = await registerAndLogin(ctx);
      await ctx.dispose();
      await use(session);
    },
    { scope: 'worker' },
  ],
  freshSession: async ({ request }, use) => {
    const session = await registerAndLogin(request);
    await use(session);
  },
});

export const expect = base.expect;

export async function primeAuth(page: Page, session: Session): Promise<void> {
  // Replay the real refresh cookie into the browser context. Tests that
  // exercise /api/auth/refresh now actually have a server-recognized
  // cookie to send; previously this was missing and a fake 1-hour
  // refreshExpiresAt was used to dodge RequireAuth's staleness check.
  if (session.cookies.length > 0) {
    await page.context().addCookies(session.cookies);
  }
  await page.addInitScript((s) => {
    localStorage.setItem(
      'smartscrape-auth',
      JSON.stringify({
        state: {
          accessToken: s.accessToken,
          refreshExpiresAt: s.refreshExpiresAt,
          user: { id: s.userId, email: s.email, name: 'E2E User', email_verified: false },
        },
        version: 0,
      }),
    );
  }, session);
}

export async function createJob(
  request: APIRequestContext,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await request.post(`${API_BASE}/api/jobs`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'E2E smoke job',
      urls: ['https://example.com'],
      extraction_prompt: 'Extract the page heading.',
      ...overrides,
    },
  });
  const body = (await res.json()) as { data: { job: { id: string } } };
  return body.data.job.id;
}
