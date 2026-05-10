import { describe, expect, it } from 'vitest';
import { STEALTH_USER_AGENTS, pickUserAgent } from './user-agents.js';

describe('pickUserAgent', () => {
  it('returns a UA from the pool', () => {
    const ua = pickUserAgent('job-1');
    expect(STEALTH_USER_AGENTS).toContain(ua);
  });

  it('is deterministic for the same seed', () => {
    expect(pickUserAgent('job-1')).toBe(pickUserAgent('job-1'));
    expect(pickUserAgent('abcdef')).toBe(pickUserAgent('abcdef'));
  });

  it('produces different UAs for different seeds (over a reasonable sample)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      seen.add(pickUserAgent(`job-${i}`));
    }
    // We have 8 UAs; with 200 random-ish seeds we should land on at least half.
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  it('distribution is roughly even across the pool', () => {
    const counts = new Map<string, number>();
    const N = 2000;
    for (let i = 0; i < N; i += 1) {
      const ua = pickUserAgent(`seed-${i}`);
      counts.set(ua, (counts.get(ua) ?? 0) + 1);
    }
    const expected = N / STEALTH_USER_AGENTS.length;
    // Allow ±35% per bucket — SHA-256 mod 8 should be much tighter than this
    // in practice, but pick a forgiving threshold to keep the test stable.
    for (const ua of STEALTH_USER_AGENTS) {
      const c = counts.get(ua) ?? 0;
      expect(c, `UA "${ua.slice(0, 40)}…"`).toBeGreaterThan(expected * 0.65);
      expect(c).toBeLessThan(expected * 1.35);
    }
  });
});
