import { describe, it, expect, vi } from 'vitest';
import { jobsRouter } from './jobs.js';

describe('jobs export route', () => {
  it('is mounted', () => {
    expect(jobsRouter).toBeTruthy();
  });
});
