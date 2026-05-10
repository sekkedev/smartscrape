import { getPool } from '../config/database.js';
import { findJob, updateJob, type JobRow } from '../db/jobs.js';
import { syncSchedule } from './job-queue.js';
import { dispatch } from './notification-service.js';
import type { ErrorType } from '../lib/error-classifier.js';

/**
 * Number of consecutive failures (most-recent runs, in order) that triggers
 * auto-pause. Three is the threshold listed in the spec — generous enough to
 * survive transient blips but tight enough to stop a job that's permanently
 * broken (auth revoked, target redesigned) before it burns a 24h quota.
 */
export const AUTO_PAUSE_THRESHOLD = 3;

/**
 * Return whether the latest `AUTO_PAUSE_THRESHOLD` runs for a job are all
 * 'failed'. Considers only terminal runs (completed | failed) — a still-in-
 * flight run (pending/scraping/extracting) doesn't break the streak.
 */
export async function isInFailureStreak(jobId: string): Promise<boolean> {
  const { rows } = await getPool().query<{ status: string }>(
    `SELECT status
       FROM scrape_runs
      WHERE job_id = $1 AND status IN ('completed', 'failed')
      ORDER BY started_at DESC
      LIMIT $2`,
    [jobId, AUTO_PAUSE_THRESHOLD],
  );
  if (rows.length < AUTO_PAUSE_THRESHOLD) return false;
  return rows.every((r) => r.status === 'failed');
}

/**
 * Compute the rolling failure rate over the last `windowSize` terminal runs,
 * expressed as a fraction in [0, 1]. Returns 0 when there are no terminal runs
 * yet (vs. NaN), so callers can render it without a null check.
 */
export async function rollingFailureRate(jobId: string, windowSize = 10): Promise<number> {
  const { rows } = await getPool().query<{ status: string }>(
    `SELECT status
       FROM scrape_runs
      WHERE job_id = $1 AND status IN ('completed', 'failed')
      ORDER BY started_at DESC
      LIMIT $2`,
    [jobId, windowSize],
  );
  if (rows.length === 0) return 0;
  const failed = rows.filter((r) => r.status === 'failed').length;
  return failed / rows.length;
}

/**
 * If the job has hit the failure threshold, disable it, tear down its
 * scheduled BullMQ entry, and dispatch a `job_failed` notification. Idempotent
 * — already-paused jobs short-circuit.
 *
 * Returns the post-action JobRow when a pause happened, or null otherwise.
 */
export async function maybeAutoPause(args: {
  jobId: string;
  userId: string;
  runId: string;
  errorType: ErrorType;
  errorMessage: string;
}): Promise<JobRow | null> {
  if (!(await isInFailureStreak(args.jobId))) return null;

  const job = await findJob(args.userId, args.jobId);
  if (!job) return null;
  if (!job.enabled) return null; // already paused — no need to re-notify

  const updated = await updateJob(args.userId, args.jobId, { enabled: false });
  if (!updated) return null;

  // Drop the repeatable so a cron-scheduled job stops firing immediately.
  try {
    await syncSchedule({
      jobId: updated.id,
      userId: updated.user_id,
      enabled: false,
      schedule: updated.schedule,
    });
  } catch (err) {
    // Schedule sync failing shouldn't block the pause — the job is already
    // marked disabled, the worker checks `enabled` before each run.
    console.error('[auto-pause] syncSchedule failed', err);
  }

  // Surface to the user via whatever notification channels they have set up.
  // Telemetry-only if they haven't configured any.
  try {
    await dispatch(updated, args.runId, [
      {
        type: 'job_failed',
        message: `Job auto-paused after ${AUTO_PAUSE_THRESHOLD} consecutive failures (${args.errorType}): ${args.errorMessage}`,
      },
    ]);
  } catch (err) {
    console.error('[auto-pause] notification dispatch failed', err);
  }

  console.warn(
    `[auto-pause] job=${args.jobId} disabled after ${AUTO_PAUSE_THRESHOLD} consecutive failures (${args.errorType})`,
  );
  return updated;
}
