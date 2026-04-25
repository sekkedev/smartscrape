import { describe, it, expect } from 'vitest';
import { validateCron } from './cron.js';

describe('validateCron', () => {
  it.each([
    '0 9 * * *', // daily at 09:00
    '0 * * * *', // hourly
    '*/5 * * * *', // every 5 minutes
    '0 0 1 * *', // monthly
    '0 9 * * 1', // weekly on Monday
  ])('accepts %s', (expr) => {
    expect(validateCron(expr).ok).toBe(true);
  });

  it.each(['', 'definitely not cron', '60 * * * *', 'every-minute', '* * *'])(
    'rejects invalid expression %s',
    (expr) => {
      const r = validateCron(expr);
      expect(r.ok).toBe(false);
    },
  );

  it('rejects schedules that fire faster than the 60s floor', () => {
    // Six fields = seconds-precision cron. Every-second.
    const r = validateCron('* * * * * *');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/too frequently/i);
      expect(r.reason).toMatch(/60s/);
    }
  });

  it('accepts every-minute (the boundary)', () => {
    expect(validateCron('* * * * *').ok).toBe(true);
  });

  it('reason field is populated on rejection', () => {
    const r = validateCron('not cron');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
  });
});
