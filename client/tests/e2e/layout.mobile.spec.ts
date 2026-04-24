import { test, expect, createJob, primeAuth } from './helpers';

/**
 * Mobile-viewport spec (runs via the 'mobile' project in playwright.config.ts).
 * The bar is: no horizontal scrollbar on any primary page, which catches
 * overflow regressions from tables/long URLs/long toast copy.
 */
test.describe.configure({ mode: 'serial' });
test.describe('mobile @ 375px', () => {
  test('primary pages have no horizontal overflow', async ({ page, request, sharedSession }) => {
    const jobId = await createJob(request, sharedSession.accessToken);
    await primeAuth(page, sharedSession);

    for (const path of ['/', '/jobs', '/notifications', '/settings', `/jobs/${jobId}`]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect.soft(scrollWidth, `horizontal overflow on ${path}`).toBeLessThanOrEqual(clientWidth + 1);
    }
  });
});
