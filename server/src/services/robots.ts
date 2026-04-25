// robots-parser ships as a CJS function export but its .d.ts declares
// the module empty before the typed default — type the call signature
// ourselves and cast through unknown.
import robotsParser from 'robots-parser';
import { assertSafeUrl } from '../lib/ssrf.js';

type Robot = {
  isAllowed(url: string, ua?: string): boolean | undefined;
};

type RobotsParserFn = (url: string, contents: string) => Robot;
const parse = robotsParser as unknown as RobotsParserFn;

const TTL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 5_000;
const MAX_ROBOTS_BYTES = 512 * 1024; // 512 KB — robots.txt above this is pathological
const MAX_REDIRECTS = 5;

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

/**
 * Fetch robots.txt with the same SSRF discipline as the main scraper:
 *   - manual redirect handling, re-validate every hop with assertSafeUrl
 *   - cap body size so a malicious robots.txt can't DoS us
 *
 * Without this, a public site whose /robots.txt 302s to http://169.254.169.254/
 * would let the robots fetch reach the metadata endpoint even though the
 * scraper proper now refuses redirects to private IPs.
 */
async function fetchRobots(url: string): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    let currentUrl = url;
    let res: Response | undefined;
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      const safety = await assertSafeUrl(currentUrl);
      if (!safety.ok) return '';
      res = await fetch(currentUrl, { redirect: 'manual', signal: ac.signal });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get('location');
        if (!next) break;
        currentUrl = new URL(next, currentUrl).toString();
        continue;
      }
      break;
    }
    if (!res || !res.ok || !res.body) return '';
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_ROBOTS_BYTES) {
        void reader.cancel();
        return '';
      }
      chunks.push(value);
    }
    return Buffer.concat(
      chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)),
    ).toString('utf8');
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
