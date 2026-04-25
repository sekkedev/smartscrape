import { chromium, type Browser } from 'playwright';
import { cleanHtml, visibleTextLength } from './html-cleaner.js';
import { assertSafeUrl } from '../lib/ssrf.js';

const USER_AGENT = 'SmartScrapeBot/0.1 (+https://github.com/9ny4/smartscrape)';
// A realistic Chrome UA used on the Playwright fallback path where we want to
// look as close to a real browser as possible. The bot UA above is kept for
// static fetches so well-behaved sites can identify us.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

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

const lastHitAt = new Map<string, number>();

async function throttle(host: string): Promise<void> {
  const last = lastHitAt.get(host) ?? 0;
  const wait = PER_HOST_DELAY_MS - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHitAt.set(host, Date.now());
}

/** Dig through the fetch error chain to produce a diagnostic message. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts: string[] = [err.message];
  let cause = (err as Error & { cause?: unknown }).cause;
  let depth = 0;
  while (cause && depth < 4) {
    if (cause instanceof Error) {
      parts.push(cause.message);
      cause = (cause as Error & { cause?: unknown }).cause;
    } else if (typeof cause === 'object' && cause && 'code' in cause) {
      parts.push(String((cause as { code: unknown }).code));
      break;
    } else {
      break;
    }
    depth++;
  }
  return parts.filter(Boolean).join(' \u2014 ');
}

async function fetchWithCap(
  url: string,
  signal?: AbortSignal,
): Promise<{ status: number; body: string; finalUrl: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('Request timeout after 15s')), 15_000);
  try {
    // Manual redirect handling so each hop is re-validated by the SSRF guard.
    // `redirect: 'follow'` would cheerfully chase a 302 to http://169.254.169.254
    // even though the original URL passed the guard.
    let currentUrl = url;
    let res: Response | undefined;
    for (let hop = 0; hop < 5; hop++) {
      const safety = await assertSafeUrl(currentUrl);
      if (!safety.ok) throw new Error(`Refused redirect to ${currentUrl}: ${safety.reason}`);
      res = await fetch(currentUrl, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
        redirect: 'manual',
        signal: signal ?? ac.signal,
      });
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get('location');
        if (!next) break;
        currentUrl = new URL(next, currentUrl).toString();
        continue;
      }
      break;
    }
    if (!res) throw new Error('No response');
    const contentLength = Number.parseInt(res.headers.get('content-length') ?? '0', 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
      throw new Error(`Page too large (${contentLength} bytes > ${MAX_BYTES})`);
    }
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
    return { status: res.status, body: buf.toString('utf8'), finalUrl: res.url };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Block any Playwright request that resolves to a private/loopback/metadata IP.
 * Without this, a public-looking URL can issue sub-resource requests, follow
 * redirects, or DNS-rebind into the internal network mid-render.
 */
async function attachSsrfRouteGuard(
  ctx: import('playwright').BrowserContext,
): Promise<void> {
  await ctx.route('**/*', async (route) => {
    const reqUrl = route.request().url();
    if (reqUrl.startsWith('data:') || reqUrl.startsWith('blob:')) {
      await route.continue();
      return;
    }
    const safety = await assertSafeUrl(reqUrl);
    if (!safety.ok) {
      await route.abort('addressunreachable');
      return;
    }
    await route.continue();
  });
}

let sharedBrowser: Browser | null = null;
let sharedBrowserHttp1Only = false;

async function browser(http1Only = false): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.isConnected() && sharedBrowserHttp1Only === http1Only) {
    return sharedBrowser;
  }
  if (sharedBrowser) await sharedBrowser.close().catch(() => undefined);
  // --disable-blink-features=AutomationControlled hides navigator.webdriver,
  // defeating the cheapest bot checks. We're not trying to be stealthy; we
  // just don't want automated browsing to be flagged on sites that'd happily
  // serve a human visitor.
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
  ];
  if (http1Only) args.push('--disable-http2');
  sharedBrowser = await chromium.launch({ headless: true, args });
  sharedBrowserHttp1Only = http1Only;
  return sharedBrowser;
}

export async function closeScraper(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => undefined);
    sharedBrowser = null;
  }
}

function isHttp2Error(err: unknown): boolean {
  return err instanceof Error && /ERR_HTTP2_PROTOCOL_ERROR/.test(err.message);
}

async function fetchViaPlaywright(
  url: string,
  http1Only = false,
): Promise<{ status: number; body: string; finalUrl: string }> {
  const b = await browser(http1Only);
  const ctx = await b.newContext({
    userAgent: BROWSER_UA,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
    },
  });
  try {
    await attachSsrfRouteGuard(ctx);
    const page = await ctx.newPage();
    // `domcontentloaded` is more forgiving than `networkidle` on pages with
    // persistent XHR/websocket activity (analytics etc).
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Give JS frameworks a small beat to render before we snapshot the DOM.
    await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => undefined);
    const body = await page.content();
    if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) {
      throw new Error(`Rendered page exceeded ${MAX_BYTES} bytes`);
    }
    return { status: response?.status() ?? 0, body, finalUrl: page.url() };
  } finally {
    await ctx.close();
  }
}

/** Playwright with one retry when the site rejects HTTP/2 (some bot walls do). */
async function fetchViaPlaywrightWithRetry(
  url: string,
): Promise<{ status: number; body: string; finalUrl: string }> {
  try {
    return await fetchViaPlaywright(url, false);
  } catch (err) {
    if (isHttp2Error(err)) {
      return await fetchViaPlaywright(url, true);
    }
    throw err;
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
    primary = await fetchViaPlaywrightWithRetry(url);
    usedMethod = 'playwright';
  } else {
    let cheerioErr: unknown = null;
    try {
      primary = await fetchWithCap(url);
      usedMethod = 'cheerio';
    } catch (err) {
      cheerioErr = err;
      if (method !== 'auto') {
        throw new Error(`Cheerio fetch failed for ${url}: ${describeError(err)}`);
      }
      // Auto mode: fall back to Playwright on fetch failure.
      await throttle(host);
      try {
        primary = await fetchViaPlaywrightWithRetry(url);
        usedMethod = 'playwright';
      } catch (pwErr) {
        throw new Error(
          `Could not load ${url}. Static fetch: ${describeError(cheerioErr)}. Browser: ${describeError(pwErr)}.`,
        );
      }
    }
    // If Cheerio succeeded but the page looks empty (likely JS-rendered SPA), try Playwright.
    if (usedMethod === 'cheerio' && method === 'auto' && visibleTextLength(primary!.body) < MIN_VISIBLE_TEXT) {
      await throttle(host);
      try {
        primary = await fetchViaPlaywrightWithRetry(url);
        usedMethod = 'playwright';
      } catch {
        // Keep the static result rather than failing outright.
      }
    }
  }

  const cleaned = cleanHtml(primary!.body);
  return {
    url,
    finalUrl: primary!.finalUrl,
    method: usedMethod,
    status: primary!.status,
    rawBytes: Buffer.byteLength(primary!.body, 'utf8'),
    cleaned,
    durationMs: Date.now() - started,
  };
}
