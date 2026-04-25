// robots-parser ships as a CJS function export but its .d.ts declares
// the module empty before the typed default — type the call signature
// ourselves and cast through unknown.
import robotsParser from 'robots-parser';

type Robot = {
  isAllowed(url: string, ua?: string): boolean | undefined;
};

type RobotsParserFn = (url: string, contents: string) => Robot;
const parse = robotsParser as unknown as RobotsParserFn;

const TTL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 5_000;

type CacheEntry = { parser: Robot; expiresAt: number };

// host (origin) → parsed robots.txt. Re-fetched after TTL_MS so updates surface.
const cache = new Map<string, CacheEntry>();

/**
 * Fetch a host's robots.txt and tell the caller whether the given URL is
 * allowed for the configured user agent. We fail OPEN on parse / fetch /
 * timeout errors — robots.txt is advisory, and a flaky robots fetch
 * shouldn't black-hole legitimate scrapes. Real disallow rules still bite.
 */
export async function isAllowedByRobots(targetUrl: string, userAgent: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return true;
  }
  const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;

  const now = Date.now();
  let entry = cache.get(parsed.origin);
  if (!entry || entry.expiresAt < now) {
    const fetched = await fetchRobots(robotsUrl);
    entry = { parser: parse(robotsUrl, fetched), expiresAt: now + TTL_MS };
    cache.set(parsed.origin, entry);
  }
  const allowed = entry.parser.isAllowed(targetUrl, userAgent);
  // robots-parser returns undefined when no rules apply → treat as allowed.
  return allowed !== false;
}

async function fetchRobots(url: string): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ac.signal });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/** Test seam — clears the parsed-robots cache. */
export function _clearRobotsCache(): void {
  cache.clear();
}
