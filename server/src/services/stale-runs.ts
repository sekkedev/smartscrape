import { sweepStaleRuns } from '../db/runs.js';

/**
 * A run older than this still sitting in a non-terminal status is treated as
 * crash debris. Two hours is far beyond any legitimate run (the scraper and
 * extractor both operate on per-request timeouts measured in seconds).
 */
export const STALE_RUN_THRESHOLD_MS = 2 * 60 * 60 * 1000;

/** How often the periodic sweep re-checks while the server is up. */
export const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

export async function sweepOnce(): Promise<number> {
  const swept = await sweepStaleRuns(STALE_RUN_THRESHOLD_MS);
  if (swept > 0) {
    console.warn(`[stale-runs] closed ${swept} interrupted run(s) older than 2h`);
  }
  return swept;
}

/**
 * Sweep immediately (catches runs orphaned by the previous process) and then
 * on an interval. The timer is unref'd so it never holds the process open
 * during shutdown.
 */
export function startStaleRunSweeper(): NodeJS.Timeout {
  void sweepOnce().catch((err) => {
    console.error('[stale-runs] boot sweep failed', err);
  });
  const timer = setInterval(() => {
    void sweepOnce().catch((err) => {
      console.error('[stale-runs] periodic sweep failed', err);
    });
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
