import { chromium, type Browser } from 'playwright';
import { cleanHtml, visibleTextLength } from './html-cleaner.js';
import { assertSafeUrl } from '../lib/ssrf.js';

const USER_AGENT = 'SmartScrapeBot/0.1 (+https://github.com/9ny4/smartscrape)';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MIN_VISIBLE_TEXT = 200; // below this, fall back to Playwright
const PER_HOST_DELAY_MS = 2_000;

export type ScrapeMethod = 'auto' | 'cheerio' | 'playwright';

export type ScrapeResult = {
  url: string;
  finalUrl: string;
  method: 'cheerio' | 'playwright';
  status: number;
  rawBytes: number;
  cleaned: string;
  durationMs: number;
};

// Remember the last time we hit each host so we can throttle.
const lastHitAt = new Map<string, number>();

async function throttle(host: string): Promise<void> {
  const last = lastHitAt.get(host) ?? 0;
  const wait = PER_HOST_DELAY_MS - (Date.now() - last);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastHitAt.set(host, Date.now());
}

async function fetchWithCap(url: string, signal?: AbortSignal): Promise<{ status: number; body: string; finalUrl: string }> {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal,
  });
  const contentLength = Number.parseInt(res.headers.get('content-length') ?? '0', 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
    throw new Error(`Page too large (${contentLength} bytes > ${MAX_BYTES})`);
  }
  // Stream and cap.
  if (!res.body) throw new Error('Empty response body');
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_BYTES) {
        void reader.cancel();
        throw new Error(`Page exceeded ${MAX_BYTES} bytes`);
      }
      chunks.push(value);
    }
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
  return {
    status: res.status,
    body: buf.toString('utf8'),
    finalUrl: res.url,
  };
}

let sharedBrowser: Browser | null = null;
async function browser(): Promise<Browser> {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    sharedBrowser = await chromium.launch({ headless: true });
  }
  return sharedBrowser;
}

export async function closeScraper(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => undefined);
    sharedBrowser = null;
  }
}

async function fetchViaPlaywright(url: string): Promise<{ status: number; body: string; finalUrl: string }> {
  const b = await browser();
  // Isolated context per scrape so cookies/storage don't leak across jobs.
  const ctx = await b.newContext({ userAgent: USER_AGENT });
  try {
    const page = await ctx.newPage();
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    const body = await page.content();
    if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) {
      throw new Error(`Rendered page exceeded ${MAX_BYTES} bytes`);
    }
    return {
      status: response?.status() ?? 0,
      body,
      finalUrl: page.url(),
    };
  } finally {
    await ctx.close();
  }
}

export async function scrape(url: string, method: ScrapeMethod = 'auto'): Promise<ScrapeResult> {
  const safety = await assertSafeUrl(url);
  if (!safety.ok) {
    throw new Error(`Refused to scrape ${url}: ${safety.reason}`);
  }
  const started = Date.now();
  const host = new URL(url).hostname;
  await throttle(host);

  let primary: { status: number; body: string; finalUrl: string };
  let usedMethod: 'cheerio' | 'playwright';

  if (method === 'playwright') {
    primary = await fetchViaPlaywright(url);
    usedMethod = 'playwright';
  } else {
    primary = await fetchWithCap(url);
    usedMethod = 'cheerio';
    if (method === 'auto' && visibleTextLength(primary.body) < MIN_VISIBLE_TEXT) {
      // Fall back: try again with headless Chromium.
      await throttle(host);
      primary = await fetchViaPlaywright(url);
      usedMethod = 'playwright';
    }
  }

  const cleaned = cleanHtml(primary.body);
  return {
    url,
    finalUrl: primary.finalUrl,
    method: usedMethod,
    status: primary.status,
    rawBytes: Buffer.byteLength(primary.body, 'utf8'),
    cleaned,
    durationMs: Date.now() - started,
  };
}
