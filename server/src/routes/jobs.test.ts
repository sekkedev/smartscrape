import { describe, it, expect } from 'vitest';
import { jobsRouter } from './jobs.js';

describe('jobs export route', () => {
  it('is mounted', () => {
    expect(jobsRouter).toBeTruthy();
  });
});
