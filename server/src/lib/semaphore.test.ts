import { describe, it, expect } from 'vitest';
import { createSemaphore } from './semaphore.js';

describe('createSemaphore', () => {
  describe('input validation', () => {
    it('rejects max < 1', () => {
      expect(() => createSemaphore(0)).toThrow(/positive integer/);
      expect(() => createSemaphore(-1)).toThrow(/positive integer/);
    });

    it('rejects non-integer max', () => {
      expect(() => createSemaphore(1.5)).toThrow(/positive integer/);
      expect(() => createSemaphore(Number.NaN)).toThrow(/positive integer/);
      expect(() => createSemaphore(Number.POSITIVE_INFINITY)).toThrow(/positive integer/);
    });
  });

  describe('basic acquire / release', () => {
    it('acquires immediately under cap', async () => {
      const sem = createSemaphore(2);
      const release1 = await sem.acquire();
      expect(sem.inUse()).toBe(1);
      expect(sem.queued()).toBe(0);
      const release2 = await sem.acquire();
      expect(sem.inUse()).toBe(2);
      expect(sem.queued()).toBe(0);
      release1();
      release2();
      expect(sem.inUse()).toBe(0);
    });

    it('queues acquires that arrive at cap', async () => {
      const sem = createSemaphore(1);
      const release1 = await sem.acquire();
      // Second acquire must wait — assert by timing it against a release.
      let acquired2 = false;
      const acquire2 = sem.acquire().then((release2) => {
        acquired2 = true;
        return release2;
      });
      // Microtask flush — acquire2 has not yet resolved.
      await Promise.resolve();
      expect(acquired2).toBe(false);
      expect(sem.queued()).toBe(1);
      release1();
      const release2 = await acquire2;
      expect(acquired2).toBe(true);
      expect(sem.inUse()).toBe(1);
      release2();
    });

    it('preserves FIFO order across multiple waiters', async () => {
      const sem = createSemaphore(1);
      const order: number[] = [];
      const release1 = await sem.acquire();

      const waiters = [1, 2, 3, 4].map((id) =>
        sem.acquire().then((release) => {
          order.push(id);
          release();
        }),
      );

      // All four are queued behind the held slot.
      await Promise.resolve();
      expect(sem.queued()).toBe(4);

      release1();
      await Promise.all(waiters);
      expect(order).toEqual([1, 2, 3, 4]);
    });
  });

  describe('release semantics', () => {
    it('double-release is a no-op', async () => {
      const sem = createSemaphore(1);
      const release = await sem.acquire();
      release();
      expect(sem.inUse()).toBe(0);
      release(); // must not double-decrement
      expect(sem.inUse()).toBe(0);
    });

    it('double-release does not wake an extra waiter', async () => {
      const sem = createSemaphore(1);
      const release1 = await sem.acquire();

      const release2Promise = sem.acquire();
      const release3Promise = sem.acquire();
      await Promise.resolve();
      expect(sem.queued()).toBe(2);

      release1();
      release1(); // double-release: must not wake the third caller too

      const release2 = await release2Promise;
      // release3 should still be queued.
      let release3Resolved = false;
      void release3Promise.then(() => {
        release3Resolved = true;
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(release3Resolved).toBe(false);
      expect(sem.queued()).toBe(1);

      release2();
      const release3 = await release3Promise;
      release3();
    });
  });

  describe('cap is never exceeded under contention', () => {
    // Regression for the bug fixed in #90: the prior hand-rolled lock
    // decremented `active` then awaited the queue tail, opening a window
    // where a fresh `acquire` saw free space and a woken waiter then
    // re-incremented past the cap.
    it('observes inUse <= max across many interleaved acquires/releases', async () => {
      const max = 3;
      const sem = createSemaphore(max);
      const observations: number[] = [];

      async function workItem(): Promise<void> {
        const release = await sem.acquire();
        observations.push(sem.inUse());
        // Yield several microtask turns to interleave with other holders.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        release();
      }

      await Promise.all(Array.from({ length: 50 }, workItem));

      expect(Math.max(...observations)).toBeLessThanOrEqual(max);
      expect(sem.inUse()).toBe(0);
      expect(sem.queued()).toBe(0);
    });

    it('exactly max are concurrently in section when contended', async () => {
      const max = 4;
      const sem = createSemaphore(max);
      let peak = 0;
      let inSection = 0;

      async function workItem(): Promise<void> {
        const release = await sem.acquire();
        inSection++;
        peak = Math.max(peak, inSection);
        await Promise.resolve();
        await Promise.resolve();
        inSection--;
        release();
      }

      // 20 items competing for 4 slots: peak should reach exactly 4.
      await Promise.all(Array.from({ length: 20 }, workItem));

      expect(peak).toBe(max);
      expect(inSection).toBe(0);
    });
  });
});
