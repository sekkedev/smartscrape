import { describe, it, expect } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { requireSameSite } from './csrf.js';
import { env } from '../config/env.js';

type ExecResult = {
  statusCode: number | null;
  jsonBody: unknown;
  calledNext: boolean;
};

function exec(headers: Record<string, string> = {}, method = 'POST'): ExecResult {
  const req = { headers, method } as unknown as Request;
  const out: ExecResult = { statusCode: null, jsonBody: null, calledNext: false };
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
  requireSameSite(req, res, next);
  return out;
}

describe('requireSameSite', () => {
  it('passes when no headers are present (curl / server-to-server)', () => {
    const out = exec({});
    expect(out.calledNext).toBe(true);
    expect(out.statusCode).toBeNull();
  });

  it('passes when Origin matches env.appUrl', () => {
    const out = exec({ origin: env.appUrl });
    expect(out.calledNext).toBe(true);
    expect(out.statusCode).toBeNull();
  });

  it('rejects 403 when Origin is set and does not match env.appUrl', () => {
    const out = exec({ origin: 'https://attacker.example.com' });
    expect(out.calledNext).toBe(false);
    expect(out.statusCode).toBe(403);
    expect(out.jsonBody).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN_ORIGIN' },
    });
  });

  it('passes when Origin header is the empty string (defensive parsing)', () => {
    const out = exec({ origin: '' });
    expect(out.calledNext).toBe(true);
  });

  it('rejects 403 when Sec-Fetch-Site is cross-site', () => {
    const out = exec({ 'sec-fetch-site': 'cross-site' });
    expect(out.calledNext).toBe(false);
    expect(out.statusCode).toBe(403);
    expect(out.jsonBody).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN_SITE' },
    });
  });

  it('passes when Sec-Fetch-Site is same-origin', () => {
    const out = exec({ 'sec-fetch-site': 'same-origin' });
    expect(out.calledNext).toBe(true);
  });

  it('passes when Sec-Fetch-Site is same-site', () => {
    const out = exec({ 'sec-fetch-site': 'same-site' });
    expect(out.calledNext).toBe(true);
  });

  it('passes when Sec-Fetch-Site is none (top-level navigation)', () => {
    const out = exec({ 'sec-fetch-site': 'none' });
    expect(out.calledNext).toBe(true);
  });

  it('rejects when both signals point cross-site (Origin wins, returns FORBIDDEN_ORIGIN)', () => {
    const out = exec({
      origin: 'https://attacker.example.com',
      'sec-fetch-site': 'cross-site',
    });
    expect(out.calledNext).toBe(false);
    expect(out.statusCode).toBe(403);
    // Origin check runs first, so the more specific code is returned.
    expect(out.jsonBody).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN_ORIGIN' },
    });
  });

  it('passes OPTIONS preflight regardless of Origin (CORS owns it)', () => {
    const out = exec(
      { origin: 'https://attacker.example.com', 'sec-fetch-site': 'cross-site' },
      'OPTIONS',
    );
    expect(out.calledNext).toBe(true);
    expect(out.statusCode).toBeNull();
  });

  it('applies to all non-OPTIONS methods (GET, POST, PATCH, DELETE)', () => {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE'] as const) {
      const out = exec({ origin: 'https://attacker.example.com' }, method);
      expect(out.calledNext, `method=${method}`).toBe(false);
      expect(out.statusCode, `method=${method}`).toBe(403);
    }
  });
});
