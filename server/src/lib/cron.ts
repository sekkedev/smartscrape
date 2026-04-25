import { CronExpressionParser } from 'cron-parser';

const MIN_INTERVAL_MS = 60_000; // 1 minute floor — the tightest schedule we'll accept

export type CronCheckResult = { ok: true } | { ok: false; reason: string };

/**
 * Validate a cron expression and reject ones that fire more often than
 * MIN_INTERVAL_MS. Without the floor, a job set to every-second cron will
 * flood BullMQ and drain provider quota.
 */
export function validateCron(expr: string): CronCheckResult {
  // The route layer treats empty/null as "no schedule". Anything that reaches
  // validateCron should be a real expression — reject empty explicitly so the
  // function can't be silently called with no input.
  if (typeof expr !== 'string' || expr.trim().length === 0) {
    return { ok: false, reason: 'Invalid cron' };
  }
  let it: ReturnType<typeof CronExpressionParser.parse>;
  try {
    it = CronExpressionParser.parse(expr);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Invalid cron' };
  }
  // Sample two consecutive ticks to derive the schedule's minimum interval.
  try {
    const a = it.next().toDate().getTime();
    const b = it.next().toDate().getTime();
    if (b - a < MIN_INTERVAL_MS) {
      return {
        ok: false,
        reason: `Schedule fires too frequently (minimum interval is ${MIN_INTERVAL_MS / 1000}s).`,
      };
    }
  } catch {
    return { ok: false, reason: 'Invalid cron' };
  }
  return { ok: true };
}
