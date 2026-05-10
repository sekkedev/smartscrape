import { describe, expect, it } from 'vitest';
import { classifyError } from './error-classifier.js';

describe('classifyError', () => {
  it.each([
    ['Daily run quota reached (100/24h). Run skipped.', 'quota_error'],
    ['HTTP 429 Too Many Requests', 'quota_error'],
    ['No openrouter API key configured', 'ai_error'],
    ['No openai API key configured', 'ai_error'],
    ['Stored provider key could not be decrypted', 'ai_error'],
    ['Extraction failed for https://example.com: invalid output', 'ai_error'],
    ['HTTP 403 Forbidden', 'blocked'],
    ['Cloudflare challenge presented', 'blocked'],
    ['Captcha required', 'blocked'],
    ['Disallowed by robots.txt', 'blocked'],
    ['Invalid JSON returned from model', 'parse_error'],
    ['Schema validation failed', 'parse_error'],
    ['Page exceeded 5242880 bytes', 'parse_error'],
    ['Empty response body', 'parse_error'],
    ['Navigation timeout of 30000ms exceeded', 'timeout'],
    ['ETIMEDOUT', 'timeout'],
    ['Request aborted', 'timeout'],
    ['fetch failed: ECONNRESET', 'network_error'],
    ['getaddrinfo ENOTFOUND example.com', 'network_error'],
    ['socket hang up', 'network_error'],
    ['something we have never seen', 'unknown'],
    [null, 'unknown'],
    [undefined, 'unknown'],
    ['', 'unknown'],
  ])('classifies %j as %s', (message, expected) => {
    expect(classifyError(message)).toBe(expected);
  });

  it('quota_error wins over generic 429-network signal (order matters)', () => {
    // Even though "fetch failed" matches network_error, the 429 + "quota"
    // signal must take precedence so users see the real cause.
    expect(classifyError('fetch failed: HTTP 429 quota exceeded')).toBe('quota_error');
  });

  it('blocked wins over generic "fetch failed" wrapping', () => {
    expect(classifyError('Cheerio fetch failed for url: HTTP 403 Forbidden')).toBe('blocked');
  });
});
