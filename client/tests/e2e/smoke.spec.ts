import { test, expect, createJob, primeAuth } from './helpers';

test.describe.configure({ mode: 'serial' });

test.describe('smoke', () => {
  // Empty-state and dark-mode tests run before any job is created under the
  // shared session — safe because describe.serial preserves order.
  test('seeded session → Home renders', async ({ page, sharedSession }) => {
    await primeAuth(page, sharedSession);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'SmartScrape' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
  });

  test('empty states: Jobs + Notifications', async ({ page, sharedSession }) => {
    await primeAuth(page, sharedSession);

    await page.goto('/jobs');
    await expect(page.getByText(/No jobs yet/i)).toBeVisible();

    await page.goto('/notifications');
    await expect(page.getByText(/No notifications yet/i)).toBeVisible();
  });

  test('dark mode toggle persists across reload', async ({ page, sharedSession }) => {
    await primeAuth(page, sharedSession);
    await page.goto('/');

    await page.locator('header button').last().click();
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Reset so later tests don't see dark class (cosmetic only).
    await page.locator('header button').last().click();
    await page.getByRole('button', { name: 'System', exact: true }).click();
  });

  test('JobForm exposes scrape method + full notification rule palette', async ({ page, sharedSession }) => {
    await primeAuth(page, sharedSession);
    await page.goto('/jobs/new');

    // NewJob boots in wizard mode; flip to the manual form where the full field
    // palette is visible.
    await page.getByRole('button', { name: /Manual setup/i }).click();

    // Labels aren't htmlFor-associated, so assert on visible text + nearby select.
    await expect(page.getByText('Scrape method', { exact: true })).toBeVisible();
    // The scrape-method <select> is the one with the distinctive Cheerio option.
    await expect(page.locator('select').filter({ hasText: 'Cheerio only (static)' })).toBeVisible();

    await page.getByRole('button', { name: /Add notification rule/i }).click();
    const ruleSelect = page.locator('select').filter({ hasText: 'Any change' }).first();
    const options = await ruleSelect.locator('option').allTextContents();
    expect(options).toEqual(
      expect.arrayContaining([
        'Any change',
        'New items appear',
        'Items disappear',
        'Field crosses threshold',
        'Field value changes',
      ]),
    );
  });

  test('XSS: script in job name renders as text, never executes', async ({ page, request, sharedSession }) => {
    // React escapes text nodes automatically, but we verify end-to-end. The
    // <img onerror> payload is chosen so any mis-handling would actually run
    // and flip a flag on window.
    const xssName = `<img src=x onerror="window.__xssTriggered=true">XSS-E2E`;
    await createJob(request, sharedSession.accessToken, { name: xssName });

    await primeAuth(page, sharedSession);
    await page.goto('/jobs');
    await page.waitForSelector('text=XSS-E2E');
    const triggered = await page.evaluate(() => (window as unknown as { __xssTriggered?: boolean }).__xssTriggered);
    expect(triggered).toBeFalsy();

    // If the angle-brackets were rendered as HTML, we'd have an <img> in the DOM.
    const imgs = await page.locator('main img').count();
    expect(imgs).toBe(0);
  });

  test('Push to Sheets button: hidden without a sheet, visible with one', async ({ page, request, sharedSession }) => {
    const jobNoSheet = await createJob(request, sharedSession.accessToken, { name: 'No-sheet job' });
    const jobWithSheet = await createJob(request, sharedSession.accessToken, {
      name: 'Sheet-linked job',
      google_sheet_id: 'FAKE_SHEET_ID_FOR_VISIBILITY_TEST',
    });

    await primeAuth(page, sharedSession);

    await page.goto(`/jobs/${jobNoSheet}`);
    await expect(page.getByRole('button', { name: 'Run now' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Push to Sheets' })).toHaveCount(0);

    await page.goto(`/jobs/${jobWithSheet}`);
    await expect(page.getByRole('button', { name: 'Push to Sheets' })).toBeVisible();
  });
});
