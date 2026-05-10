import { chromium, type Browser } from 'playwright';
import { ProxyAgent, type Dispatcher } from 'undici';
import { cleanHtml, visibleTextLength } from './html-cleaner.js';
import { assertSafeUrl } from '../lib/ssrf.js';
import { createSemaphore } from '../lib/semaphore.js';
import { isAllowedByRobots } from './robots.js';
import { pickUserAgent } from '../lib/user-agents.js';
import { STEALTH_INIT_SCRIPT } from '../lib/stealth.js';

const USER_AGENT = 'SmartScrapeBot/0.1 (+https://github.com/9ny4/smartscrape)';
// A realistic Chrome UA used on the Playwright fallback path where we want to
// look as close to a real browser as possible. The bot UA above is kept for
// static fetches so well-behaved sites can identify us.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/**
 * Parse a Playwright-shaped proxy config out of an http(s)://user:pass@host
 * URL. Returns null when the input is blank so callers can fall straight
 * through to a normal launch.
 */
export function parseProxy(proxyUrl: string | null | undefined): {
  server: string;
  username?: string;
  password?: string;
} | null {
  if (!proxyUrl) return null;
  let u: URL;
  try {
    u = new URL(proxyUrl);
  } catch {
    return null;
  }
  const server = `${u.protocol}//${u.host}`;
  const out: { server: string; username?: string; password?: string } = { server };
  if (u.username) out.username = decodeURIComponent(u.username);
  if (u.password) out.password = decodeURIComponent(u.password);
  return out;
}

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MIN_VISIBLE_TEXT = 200; // below this, fall back to Playwright
const PER_HOST_DELAY_MS = 2_000;
function readMaxPlaywrightContexts(): number {
  const raw = process.env.SCRAPER_MAX_PLAYWRIGHT_CONTEXTS;
  if (raw === undefined || raw === '') return 2;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `SCRAPER_MAX_PLAYWRIGHT_CONTEXTS must be a positive integer (got ${JSON.stringify(raw)})`,
    );
  }
  return parsed;
}
const MAX_PLAYWRIGHT_CONTEXTS = readMaxPlaywrightContexts();

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
const playwrightSlots = createSemaphore(MAX_PLAYWRIGHT_CONTEXTS);

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

type FetchOpts = {
  userAgent?: string;
  proxyUrl?: string | null;
};

async function fetchWithCap(
  url: string,
  signal?: AbortSignal,
  opts: FetchOpts = {},
): Promise<{ status: number; body: string; finalUrl: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('Request timeout after 15s')), 15_000);
  // Per-request proxy via undici. Without `dispatcher`, fetch uses the global
  // dispatcher (which honors HTTP_PROXY when set at process start).
  let dispatcher: Dispatcher | undefined;
  if (opts.proxyUrl) {
    dispatcher = new ProxyAgent(opts.proxyUrl);
  }
  const userAgent = opts.userAgent ?? USER_AGENT;
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
        headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml' },
        redirect: 'manual',
        signal: signal ?? ac.signal,
        // The `dispatcher` field is a non-standard fetch option recognised by
        // Node's bundled undici. Cast keeps TS happy without polluting the
        // global RequestInit type.
        ...(dispatcher ? ({ dispatcher } as unknown as RequestInit) : {}),
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
    // ProxyAgent holds connections open; closing is fire-and-forget so a slow
    // proxy doesn't drag the run worker.
    if (dispatcher) void dispatcher.close().catch(() => undefined);
  }
}

/**
 * Block any Playwright request that resolves to a private/loopback/metadata IP.
 * Without this, a public-looking URL can issue sub-resource requests, follow
 * redirects, or DNS-rebind into the internal network mid-render.
 */
async function attachSsrfRouteGuard(ctx: import('playwright').BrowserContext): Promise<void> {
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

type PlaywrightOpts = {
  userAgent?: string;
  proxyUrl?: string | null;
  stealth?: boolean;
};

async function fetchViaPlaywright(
  url: string,
  http1Only = false,
  opts: PlaywrightOpts = {},
): Promise<{ status: number; body: string; finalUrl: string }> {
  const release = await playwrightSlots.acquire();
  const b = await browser(http1Only);
  const proxy = parseProxy(opts.proxyUrl);
  const ctx = await b.newContext({
    userAgent: opts.userAgent ?? BROWSER_UA,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
    },
    ...(proxy ? { proxy } : {}),
  });
  try {
    await attachSsrfRouteGuard(ctx);
    if (opts.stealth) {
      // Inject our minimal stealth init script before any page script runs.
      // See server/src/lib/stealth.ts for what it patches and why.
      await ctx.addInitScript(STEALTH_INIT_SCRIPT);
    }
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
    release();
  }
}

/** Playwright with one retry when the site rejects HTTP/2 (some bot walls do). */
async function fetchViaPlaywrightWithRetry(
  url: string,
  opts: PlaywrightOpts = {},
): Promise<{ status: number; body: string; finalUrl: string }> {
  try {
    return await fetchViaPlaywright(url, false, opts);
  } catch (err) {
    if (isHttp2Error(err)) {
      return await fetchViaPlaywright(url, true, opts);
    }
    throw err;
  }
}

export type ScrapeOptions = {
  /** When true (default) we honor robots.txt for the configured user-agent. */
  respectRobotsTxt?: boolean;
  /**
   * When true, switch the Cheerio + Playwright paths to a rotating real-browser
   * UA (deterministic per `stealthSeed`) and inject the Playwright stealth init
   * script. Per-job toggle from `scrape_jobs.stealth_mode`.
   */
  stealth?: boolean;
  /**
   * Stable seed for the UA picker — usually the job id. Same seed → same UA
   * across runs, which keeps target-site caching/cookies coherent.
   */
  stealthSeed?: string;
  /** Per-job proxy (http(s)://[user:pass@]host:port). Overrides process env. */
  proxyUrl?: string | null;
};

export async function scrape(
  url: string,
  method: ScrapeMethod = 'auto',
  opts: ScrapeOptions = {},
): Promise<ScrapeResult> {
  const safety = await assertSafeUrl(url);
  if (!safety.ok) {
    throw new Error(`Refused to scrape ${url}: ${safety.reason}`);
  }
  if (opts.respectRobotsTxt !== false) {
    const allowed = await isAllowedByRobots(url, USER_AGENT);
    if (!allowed) {
      throw new Error(
        `robots.txt disallows ${USER_AGENT} for ${url}. Set "Respect robots.txt" to off on this job to override.`,
      );
    }
  }
  const started = Date.now();
  const host = new URL(url).hostname;
  await throttle(host);

  // When stealth_mode is on, pick a rotating real-browser UA seeded by the
  // job id. Otherwise stick with our identifiable bot UA on the static path
  // and the fixed Chrome UA on the Playwright path.
  const stealthUa = opts.stealth && opts.stealthSeed ? pickUserAgent(opts.stealthSeed) : null;
  const cheerioUa = stealthUa ?? USER_AGENT;
  const playwrightOpts: PlaywrightOpts = {
    userAgent: stealthUa ?? BROWSER_UA,
    proxyUrl: opts.proxyUrl ?? null,
    stealth: Boolean(opts.stealth),
  };
  const fetchOpts: FetchOpts = {
    userAgent: cheerioUa,
    proxyUrl: opts.proxyUrl ?? null,
  };

  let primary: { status: number; body: string; finalUrl: string };
  let usedMethod: 'cheerio' | 'playwright';

  if (method === 'playwright') {
    primary = await fetchViaPlaywrightWithRetry(url, playwrightOpts);
    usedMethod = 'playwright';
  } else {
    let cheerioErr: unknown = null;
    try {
      primary = await fetchWithCap(url, undefined, fetchOpts);
      usedMethod = 'cheerio';
    } catch (err) {
      cheerioErr = err;
      if (method !== 'auto') {
        throw new Error(`Cheerio fetch failed for ${url}: ${describeError(err)}`);
      }
      // Auto mode: fall back to Playwright on fetch failure.
      await throttle(host);
      try {
        primary = await fetchViaPlaywrightWithRetry(url, playwrightOpts);
        usedMethod = 'playwright';
      } catch (pwErr) {
        throw new Error(
          `Could not load ${url}. Static fetch: ${describeError(cheerioErr)}. Browser: ${describeError(pwErr)}.`,
        );
      }
    }
    // If Cheerio succeeded but the page looks empty (likely JS-rendered SPA), try Playwright.
    if (
      usedMethod === 'cheerio' &&
      method === 'auto' &&
      visibleTextLength(primary!.body) < MIN_VISIBLE_TEXT
    ) {
      await throttle(host);
      try {
        primary = await fetchViaPlaywrightWithRetry(url, playwrightOpts);
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
