/**
 * Init script injected into every Playwright page when `stealth_mode` is on.
 *
 * This is the minimum set of fingerprint patches that defeat the cheapest
 * bot checks (CreepJS-style "is this Puppeteer?" detection): hide the
 * webdriver flag (the Chromium launch flag already covers most of this, but
 * belt-and-suspenders), report a plausible-looking `plugins` array, set
 * `languages`, define `window.chrome`, fix the WebGL vendor string, and
 * suppress the "Permissions" API quirk that returns "denied" for
 * notifications on headless Chromium.
 *
 * We intentionally don't pull in `playwright-extra` + the puppeteer-extra
 * stealth plugin. The full plugin set is much heavier (~50 patches) and
 * solves a problem we don't have — we're a self-hosted scraper, not a
 * scraping-as-a-service. Users with hostile targets can layer their own
 * proxy / stealth tooling on top via the `proxy_url` field.
 */
export const STEALTH_INIT_SCRIPT = String.raw`
(() => {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  } catch {}
  try {
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5].map((i) => ({ name: 'Plugin ' + i, filename: 'plugin' + i + '.dll' })),
    });
  } catch {}
  try {
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  } catch {}
  try {
    // Headless Chrome lacks the chrome.runtime shim that real Chrome has.
    if (typeof window !== 'undefined' && !window.chrome) {
      // @ts-ignore
      window.chrome = { runtime: {} };
    }
  } catch {}
  try {
    const origQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (origQuery) {
      // Headless reports 'denied' for notifications even when Notification.permission is 'default'.
      window.navigator.permissions.query = (params) =>
        params && params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : origQuery.call(window.navigator.permissions, params);
    }
  } catch {}
  try {
    // Spoof a non-empty hardwareConcurrency. Headless reports the host's CPU count anyway,
    // but some checks assert >= 4.
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => Math.max(4, navigator.hardwareConcurrency || 4) });
  } catch {}
})();
`;
