import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

// Mocks for the DB + JWT dependencies the middleware imports. Vitest hoists
// vi.mock to the top of the file, so these apply to the SUT below.
vi.mock('../db/personalAccessTokens.js', () => ({
  findActiveByHash: vi.fn(),
  touchLastUsed: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../db/users.js', () => ({
  findUserById: vi.fn(),
}));
vi.mock('../lib/jwt.js', () => ({
  verifyAccessToken: vi.fn(),
}));

import { findActiveByHash, touchLastUsed } from '../db/personalAccessTokens.js';
import { findUserById } from '../db/users.js';
import { verifyAccessToken } from '../lib/jwt.js';

type ExecResult = {
  statusCode: number | null;
  jsonBody: unknown;
  calledNext: boolean;
  user: { id: string; email: string } | undefined;
};

function makeReq(headers: Record<string, string>): Request {
  return {
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

/**
 * The auth module keeps an in-memory debounce cache as module-level state. To
 * test cleanly each case re-imports the SUT after `vi.resetModules()`, which
 * also re-binds the mocked deps below to fresh `vi.fn()` instances.
 */
async function freshExec(
  headers: Record<string, string>,
): Promise<ExecResult & { mod: typeof import('./auth.js') }> {
  vi.resetModules();
  // Re-declare mocks against the reset module registry — without this the
  // re-imported SUT would resolve to the real modules.
  vi.doMock('../db/personalAccessTokens.js', () => ({
    findActiveByHash,
    touchLastUsed,
  }));
  vi.doMock('../db/users.js', () => ({ findUserById }));
  vi.doMock('../lib/jwt.js', () => ({ verifyAccessToken }));
  const mod = await import('./auth.js');
  const req = makeReq(headers);
  const out: ExecResult = { statusCode: null, jsonBody: null, calledNext: false, user: undefined };
  const res = {
    status(n: number) {
      out.statusCode = n;
      return this;
    },
    json(payload: unknown) {
      out.jsonBody = payload;
      return this;
    },
  } as unknown as Response;
  const next: NextFunction = () => {
    out.calledNext = true;
  };
  await mod.requireAuth(req, res, next);
  out.user = (req as unknown as { user?: { id: string; email: string } }).user;
  return { ...out, mod };
}

const fakeUserRow = {
  id: 'u-1',
  email: 'alice@example.com',
  password_hash: '',
  name: null,
  email_verified: true,
  verification_token: null,
  reset_token: null,
  reset_token_expires: null,
  telegram_chat_id: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const fakePatRow = {
  id: 'pat-1',
  user_id: 'u-1',
  name: 'ci',
  token_hash: 'hash',
  prefix: 'sst_xxxxxxxx',
  last_used_at: null,
  created_at: new Date(),
  revoked_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default success returns; individual tests override.
  vi.mocked(touchLastUsed).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('requireAuth — PAT path', () => {
  it('authenticates an active PAT presented via X-API-Key', async () => {
    vi.mocked(findActiveByHash).mockResolvedValueOnce(fakePatRow);
    vi.mocked(findUserById).mockResolvedValueOnce(fakeUserRow);
    const out = await freshExec({ 'x-api-key': 'sst_abc' });
    expect(out.calledNext).toBe(true);
    expect(out.user).toEqual({ id: 'u-1', email: 'alice@example.com' });
  });

  it('also accepts a PAT in Authorization: Bearer (sst_ prefix)', async () => {
    vi.mocked(findActiveByHash).mockResolvedValueOnce(fakePatRow);
    vi.mocked(findUserById).mockResolvedValueOnce(fakeUserRow);
    const out = await freshExec({ authorization: 'Bearer sst_abc' });
    expect(out.calledNext).toBe(true);
    expect(out.user?.id).toBe('u-1');
    // Crucially: when prefix is sst_, we never fall through to JWT verify.
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects 401 when the PAT does not match an active row', async () => {
    vi.mocked(findActiveByHash).mockResolvedValueOnce(null);
    const out = await freshExec({ 'x-api-key': 'sst_bad' });
    expect(out.calledNext).toBe(false);
    expect(out.statusCode).toBe(401);
    expect(out.jsonBody).toMatchObject({
      success: false,
      error: { code: 'UNAUTHORIZED' },
    });
  });

  it('rejects 401 when the PAT row points at a deleted user', async () => {
    vi.mocked(findActiveByHash).mockResolvedValueOnce(fakePatRow);
    vi.mocked(findUserById).mockResolvedValueOnce(null);
    const out = await freshExec({ 'x-api-key': 'sst_abc' });
    expect(out.calledNext).toBe(false);
    expect(out.statusCode).toBe(401);
  });

  it('debounces last_used_at: first call writes, immediate second does not', async () => {
    vi.mocked(findActiveByHash).mockResolvedValue(fakePatRow);
    vi.mocked(findUserById).mockResolvedValue(fakeUserRow);
    vi.resetModules();
    vi.doMock('../db/personalAccessTokens.js', () => ({
      findActiveByHash,
      touchLastUsed,
    }));
    vi.doMock('../db/users.js', () => ({ findUserById }));
    vi.doMock('../lib/jwt.js', () => ({ verifyAccessToken }));
    const mod = await import('./auth.js');
    const req1 = makeReq({ 'x-api-key': 'sst_abc' });
    const noopRes = { status: () => noopRes, json: () => noopRes } as unknown as Response;
    await mod.requireAuth(req1, noopRes, () => {});
    expect(touchLastUsed).toHaveBeenCalledTimes(1);
    const req2 = makeReq({ 'x-api-key': 'sst_abc' });
    await mod.requireAuth(req2, noopRes, () => {});
    // Still 1 — the second hit is inside the 60s debounce window. Same SUT
    // instance, so the in-memory cache persists across the two calls.
    expect(touchLastUsed).toHaveBeenCalledTimes(1);
  });
});

describe('requireAuth — JWT path', () => {
  it('authenticates a valid Bearer JWT', async () => {
    vi.mocked(verifyAccessToken).mockReturnValueOnce({
      sub: 'u-2',
      email: 'bob@example.com',
    } as ReturnType<typeof verifyAccessToken>);
    const out = await freshExec({ authorization: 'Bearer eyJhbGciOi...' });
    expect(out.calledNext).toBe(true);
    expect(out.user).toEqual({ id: 'u-2', email: 'bob@example.com' });
  });

  it('rejects 401 when the JWT fails verification', async () => {
    vi.mocked(verifyAccessToken).mockImplementationOnce(() => {
      throw new Error('expired');
    });
    const out = await freshExec({ authorization: 'Bearer eyJ.bad' });
    expect(out.calledNext).toBe(false);
    expect(out.statusCode).toBe(401);
  });

  it('rejects 401 when no auth header is present', async () => {
    const out = await freshExec({});
    expect(out.calledNext).toBe(false);
    expect(out.statusCode).toBe(401);
  });

  it('rejects 401 when Authorization header is malformed', async () => {
    const out = await freshExec({ authorization: 'NotBearer foo' });
    expect(out.calledNext).toBe(false);
    expect(out.statusCode).toBe(401);
  });

  it('X-API-Key wins when both headers are present', async () => {
    vi.mocked(findActiveByHash).mockResolvedValueOnce(fakePatRow);
    vi.mocked(findUserById).mockResolvedValueOnce(fakeUserRow);
    const out = await freshExec({
      'x-api-key': 'sst_abc',
      authorization: 'Bearer eyJ.something',
    });
    expect(out.calledNext).toBe(true);
    expect(out.user?.id).toBe('u-1');
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });
});
