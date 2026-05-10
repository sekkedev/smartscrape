import { createHash } from 'node:crypto';

/**
 * A small pool of recent real-browser UAs. We rotate among these when a job
 * has stealth_mode enabled. The pool is intentionally short: enough variety
 * to avoid one-UA fingerprinting, but stable enough that a target site sees
 * the same UA for a given job across runs (deterministic by job id).
 *
 * Keep entries roughly current. Old strings still work but raise eyebrows.
 */
export const STEALTH_USER_AGENTS = [
  // Chrome 132 / Windows 10
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  // Chrome 132 / macOS 14
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  // Firefox 134 / Windows 10
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
  // Firefox 134 / macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:134.0) Gecko/20100101 Firefox/134.0',
  // Safari 18 / macOS Sequoia
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  // Edge 132 / Windows 11
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0',
  // Chrome 131 / Windows 11
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  // Chrome 131 / Linux
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
] as const;

/**
 * Pick a UA from the pool deterministically given a seed string. The same
 * seed always returns the same UA — used so a given job presents a stable
 * identity across runs (server-side caches, A/B cookies, and per-IP heuristics
 * all benefit from stability over randomness).
 */
export function pickUserAgent(seed: string): string {
  const digest = createHash('sha256').update(seed).digest();
  // First byte of the hash → modulo pool length. Cheap and uniform enough.
  const idx = digest[0]! % STEALTH_USER_AGENTS.length;
  return STEALTH_USER_AGENTS[idx]!;
}
