/**
 * Bounded-concurrency semaphore: at most N holders in the critical section
 * at once.
 *
 * Uses **slot-conservation handoff**: when a holder releases and a waiter is
 * queued, the slot is handed directly to the waiter — the active count never
 * visibly drops below the cap during the handoff. The naive alternative
 * (decrement counter, then wake a waiter who increments back) opens a race
 * where a fresh `acquire` call landing between those two steps sees free
 * space and over-fills the cap.
 *
 * Each `acquire` resolves with a fresh, single-use `release` closure;
 * calling it more than once is a no-op.
 */
export type Semaphore = {
  /**
   * Acquire one slot. Resolves with a single-use `release` function that
   * MUST be called exactly once when the holder is done with the slot.
   */
  acquire(): Promise<() => void>;
  /** Slots currently held. Diagnostic / test introspection. */
  inUse(): number;
  /** Waiters currently queued. Diagnostic / test introspection. */
  queued(): number;
};

export function createSemaphore(max: number): Semaphore {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`createSemaphore: max must be a positive integer (got ${String(max)})`);
  }
  let active = 0;
  const queue: Array<() => void> = [];

  function makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      // Hand off to a queued waiter if any. The slot stays counted-as-in-use
      // across the handoff so a fresh `acquire` cannot see free space and
      // over-fill the cap.
      const next = queue.shift();
      if (next) {
        next();
        return;
      }
      active--;
    };
  }

  async function acquire(): Promise<() => void> {
    if (active < max) {
      active++;
      return makeRelease();
    }
    // Wait for a release to wake us. The slot is reserved for us by the
    // releaser — we do NOT increment `active` after wake.
    await new Promise<void>((resolve) => queue.push(resolve));
    return makeRelease();
  }

  return {
    acquire,
    inUse: () => active,
    queued: () => queue.length,
  };
}
