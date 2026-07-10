import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/database.js', () => ({
  getPool: vi.fn(),
}));
vi.mock('../db/jobs.js', () => ({
  findJob: vi.fn(),
  updateJob: vi.fn(),
}));
vi.mock('./job-queue.js', () => ({
  syncSchedule: vi.fn(),
}));
vi.mock('./notification-service.js', () => ({
  dispatch: vi.fn(),
}));

import {
  AUTO_PAUSE_THRESHOLD,
  isInFailureStreak,
  maybeAutoPause,
  rollingFailureRate,
} from './auto-pause.js';
import { getPool } from '../config/database.js';
import { findJob, updateJob } from '../db/jobs.js';
import { syncSchedule } from './job-queue.js';
import { dispatch } from './notification-service.js';

type FakePool = { query: ReturnType<typeof vi.fn> };

function poolReturning(rows: { status: string }[]): FakePool {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const baseJob = {
  id: 'job-1',
  user_id: 'user-1',
  name: 'Test job',
  urls: [],
  extraction_prompt: '',
  extraction_schema: null,
  scrape_method: 'auto',
  schedule: null,
  enabled: true,
  notification_rules: [],
  notify_channels: [],
  comparison_key: null,
  ai_provider: 'openrouter',
  ai_model: 'openai/gpt-4o-mini',
  google_sheet_id: null,
  sheet_tab_name: null,
  setup_method: 'manual',
  respect_robots_txt: true,
  webhook_url: null,
  webhook_secret_encrypted: null,
  last_run_at: null,
  created_at: new Date(),
  updated_at: new Date(),
} as unknown as Awaited<ReturnType<typeof findJob>>;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isInFailureStreak', () => {
  it('returns false when there are fewer than threshold terminal runs', async () => {
    vi.mocked(getPool).mockReturnValue(poolReturning([{ status: 'failed' }]) as never);
    expect(await isInFailureStreak('job-1')).toBe(false);
  });

  it('returns true when the last N runs are all failed', async () => {
    vi.mocked(getPool).mockReturnValue(
      poolReturning(Array(AUTO_PAUSE_THRESHOLD).fill({ status: 'failed' })) as never,
    );
    expect(await isInFailureStreak('job-1')).toBe(true);
  });

  it('returns false when at least one recent run completed', async () => {
    vi.mocked(getPool).mockReturnValue(
      poolReturning([{ status: 'failed' }, { status: 'completed' }, { status: 'failed' }]) as never,
    );
    expect(await isInFailureStreak('job-1')).toBe(false);
  });

  it('excludes quota-limited and interrupted runs from the streak window', async () => {
    const pool = poolReturning([]);
    vi.mocked(getPool).mockReturnValue(pool as never);
    await isInFailureStreak('job-1');
    const [sql] = pool.query.mock.calls[0]!;
    // The window must ignore runs that say nothing about job health: quota
    // skips and crash-orphaned runs closed by the stale-run sweeper.
    expect(sql).toContain("NOT IN ('quota_error', 'interrupted')");
  });
});

describe('rollingFailureRate', () => {
  it('returns 0 when there are no terminal runs yet', async () => {
    vi.mocked(getPool).mockReturnValue(poolReturning([]) as never);
    expect(await rollingFailureRate('job-1')).toBe(0);
  });

  it('returns the proportion of failed in the window', async () => {
    vi.mocked(getPool).mockReturnValue(
      poolReturning([
        { status: 'failed' },
        { status: 'failed' },
        { status: 'failed' },
        { status: 'completed' },
      ]) as never,
    );
    expect(await rollingFailureRate('job-1')).toBe(0.75);
  });
});

describe('maybeAutoPause', () => {
  it('does nothing when streak threshold is not met', async () => {
    vi.mocked(getPool).mockReturnValue(poolReturning([{ status: 'failed' }]) as never);
    const result = await maybeAutoPause({
      jobId: 'job-1',
      userId: 'user-1',
      runId: 'run-1',
      errorType: 'blocked',
      errorMessage: '403',
    });
    expect(result).toBeNull();
    expect(updateJob).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('disables the job, syncs the schedule, and dispatches a notification on streak', async () => {
    vi.mocked(getPool).mockReturnValue(
      poolReturning(Array(AUTO_PAUSE_THRESHOLD).fill({ status: 'failed' })) as never,
    );
    vi.mocked(findJob).mockResolvedValueOnce(baseJob);
    vi.mocked(updateJob).mockResolvedValueOnce({ ...baseJob, enabled: false } as never);

    const result = await maybeAutoPause({
      jobId: 'job-1',
      userId: 'user-1',
      runId: 'run-1',
      errorType: 'blocked',
      errorMessage: 'HTTP 403 Forbidden',
    });

    expect(result).not.toBeNull();
    expect(updateJob).toHaveBeenCalledWith('user-1', 'job-1', { enabled: false });
    expect(syncSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1', enabled: false }),
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    const [, runIdArg, notifs] = vi.mocked(dispatch).mock.calls[0]!;
    expect(runIdArg).toBe('run-1');
    expect(notifs).toEqual([
      {
        type: 'job_failed',
        message: expect.stringContaining('Job auto-paused after 3 consecutive failures (blocked)'),
      },
    ]);
  });

  it('short-circuits when the job is already disabled (idempotent)', async () => {
    vi.mocked(getPool).mockReturnValue(
      poolReturning(Array(AUTO_PAUSE_THRESHOLD).fill({ status: 'failed' })) as never,
    );
    vi.mocked(findJob).mockResolvedValueOnce({ ...baseJob, enabled: false } as never);

    const result = await maybeAutoPause({
      jobId: 'job-1',
      userId: 'user-1',
      runId: 'run-1',
      errorType: 'blocked',
      errorMessage: '403',
    });
    expect(result).toBeNull();
    expect(updateJob).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
