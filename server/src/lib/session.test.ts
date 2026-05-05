import { describe, it, expect } from 'vitest';
import { refreshCookieOptions } from './session.js';

describe('refreshCookieOptions', () => {
  it('sets HttpOnly refresh cookie attributes', () => {
    const expiresAt = new Date('2030-01-01T00:00:00.000Z');
    const opts = refreshCookieOptions(expiresAt);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe('lax');
    expect(opts.path).toBe('/api/auth');
    expect(opts.expires).toEqual(expiresAt);
  });
});
