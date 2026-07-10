import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/runs.js', () => ({
  sweepStaleRuns: vi.fn(),
}));

import {
  STALE_RUN_THRESHOLD_MS,
  SWEEP_INTERVAL_MS,
  startStaleRunSweeper,
  sweepOnce,
} from './stale-runs.js';
import { sweepStaleRuns } from '../db/runs.js';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sweepOnce', () => {
  it('sweeps with the 2h threshold and returns the count', async () => {
    vi.mocked(sweepStaleRuns).mockResolvedValueOnce(3);
    expect(await sweepOnce()).toBe(3);
    expect(sweepStaleRuns).toHaveBeenCalledWith(STALE_RUN_THRESHOLD_MS);
  });

  it('stays quiet when nothing is stale', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(sweepStaleRuns).mockResolvedValueOnce(0);
    expect(await sweepOnce()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('startStaleRunSweeper', () => {
  it('sweeps immediately and again on the interval, surviving a failing sweep', async () => {
    vi.useFakeTimers();
    vi.mocked(sweepStaleRuns)
      .mockRejectedValueOnce(new Error('db down')) // boot sweep fails → logged, not thrown
      .mockResolvedValueOnce(1);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const timer = startStaleRunSweeper();
    // Flush the boot sweep's microtasks (the rejection lands in .catch()).
    await vi.advanceTimersByTimeAsync(0);
    expect(sweepStaleRuns).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(sweepStaleRuns).toHaveBeenCalledTimes(2);

    clearInterval(timer);
    error.mockRestore();
  });
});
