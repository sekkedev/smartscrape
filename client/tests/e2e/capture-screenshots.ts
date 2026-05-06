/**
 * Not a test — a Playwright-driven screenshot capture script. Seeds a user via
 * the API, drives the UI through the key screens, and writes PNGs under
 * `docs/screenshots/`. Run with:
 *
 *   npm run docs:screenshots --workspace client
 *
 * Requires: dev servers on :3000 + :5173, and OPENROUTER_DEV_KEY set if you
 * want a real run to appear in the Job Detail screenshot (optional — the flow
 * still completes with no completed runs).
 */
import { chromium, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const API_BASE = 'http://localhost:3000';
const UI_BASE = 'http://localhost:5173';
const OUT_DIR = resolve(process.cwd(), '..', 'docs', 'screenshots');

type Session = { accessToken: string; userId: string; email: string };

async function api<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${res.status} ${path}: ${await res.text()}`);
  const body = (await res.json()) as { data: T };
  return body.data;
}

async function seed(): Promise<Session> {
  const email = `demo-${Date.now()}@local.test`;
  const password = 'DemoPass123!';
  await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name: 'Demo' }),
  });
  const login = await api<{ accessToken: string; user: { id: string } }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const session: Session = {
    accessToken: login.accessToken,
    userId: login.user.id,
    email,
  };

  // Store a provider key so the Settings screenshot shows the connected state.
  // Uses OPENROUTER_DEV_KEY if present, otherwise a placeholder (still renders
  // the "connected" row; test button will show invalid, which is fine).
  const demoKey =
    process.env.OPENROUTER_DEV_KEY ?? 'sk-or-v1-demo-placeholder-key-for-screenshot-only';
  await api('/api/providers', {
    method: 'POST',
    token: session.accessToken,
    body: JSON.stringify({ provider: 'openrouter', apiKey: demoKey }),
  });

  // A few jobs so the Jobs list and Home page aren't empty in the shots.
  await api('/api/jobs', {
    method: 'POST',
    token: session.accessToken,
    body: JSON.stringify({
      name: 'Book bestsellers tracker',
      urls: ['https://books.toscrape.com/'],
      extraction_prompt: 'Extract each book with title, price in pounds, and stock availability.',
      extraction_schema: { title: 'string', price: 'string', in_stock: 'boolean' },
      comparison_key: 'title',
      schedule: '0 9 * * *',
      notification_rules: [
        { type: 'new_items', message: 'New book listed: {title}' },
        { type: 'field_change', field: 'price', message: '{title}: {old} → {new}' },
      ],
      notify_channels: ['email'],
    }),
  });

  await api('/api/jobs', {
    method: 'POST',
    token: session.accessToken,
    body: JSON.stringify({
      name: 'Espresso House menu',
      urls: ['https://no.espressohouse.com/menu'],
      extraction_prompt: 'Extract each menu item with its category and name.',
      extraction_schema: { category: 'string', item_name: 'string' },
      scrape_method: 'playwright',
    }),
  });

  return session;
}

async function primeAuth(page: Page, session: Session): Promise<void> {
  await page.goto(UI_BASE);
  await page.evaluate((s) => {
    localStorage.setItem(
      'smartscrape-auth',
      JSON.stringify({
        state: {
          accessToken: s.accessToken,
          user: { id: s.userId, email: s.email, name: 'Demo', email_verified: false },
        },
        version: 0,
      }),
    );
  }, session);
}

async function shot(page: Page, path: string, name: string): Promise<void> {
  await page.goto(`${UI_BASE}${path}`);
  await page.waitForLoadState('networkidle');
  // Small settle for skeleton → data transitions.
  await page.waitForTimeout(500);
  const file = resolve(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  wrote ${name}.png`);
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  console.log('seeding demo data…');
  const session = await seed();

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await primeAuth(page, session);

    console.log('capturing desktop shots…');
    await shot(page, '/', 'home');
    await shot(page, '/jobs', 'jobs-list');
    await shot(page, '/jobs/new', 'new-job-wizard');
    await shot(page, '/notifications', 'notifications');
    await shot(page, '/settings', 'settings');

    // Job detail (use the first job we seeded)
    const jobs = await api<{ items: { id: string }[] }>('/api/jobs', {
      token: session.accessToken,
    });
    if (jobs.items.length > 0) {
      await shot(page, `/jobs/${jobs.items[0]!.id}`, 'job-detail');
      await shot(page, `/jobs/${jobs.items[0]!.id}/edit`, 'edit-job');
    }

    // Mobile viewport capture for one or two canonical pages.
    const mobile = await browser.newContext({
      viewport: { width: 393, height: 851 },
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 5)',
      deviceScaleFactor: 2.75,
      isMobile: true,
      hasTouch: true,
    });
    const mpage = await mobile.newPage();
    await primeAuth(mpage, session);
    console.log('capturing mobile shots…');
    await shot(mpage, '/', 'mobile-home');
    await shot(mpage, '/jobs', 'mobile-jobs');

    // Write a small provenance file so README editors know the source.
    await writeFile(
      resolve(OUT_DIR, 'README.txt'),
      'Generated by client/tests/e2e/capture-screenshots.ts. Re-run with `npm run docs:screenshots --workspace client`.\n',
    );
    console.log('done.');
  } finally {
    await browser.close();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
