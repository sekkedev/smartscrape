import { describe, expect, it } from 'vitest';
import { parseProxy } from './scraper.js';

describe('parseProxy', () => {
  it('returns null for blank / nullish input', () => {
    expect(parseProxy(null)).toBeNull();
    expect(parseProxy(undefined)).toBeNull();
    expect(parseProxy('')).toBeNull();
  });

  it('parses bare http://host:port', () => {
    expect(parseProxy('http://proxy.example.com:3128')).toEqual({
      server: 'http://proxy.example.com:3128',
    });
  });

  it('extracts username/password from the URL userinfo', () => {
    expect(parseProxy('http://alice:s3cret@proxy.example.com:3128')).toEqual({
      server: 'http://proxy.example.com:3128',
      username: 'alice',
      password: 's3cret',
    });
  });

  it('URL-decodes credentials so reserved characters survive the round-trip', () => {
    expect(parseProxy('http://us%40er:p%2Fass@proxy:8080')).toEqual({
      server: 'http://proxy:8080',
      username: 'us@er',
      password: 'p/ass',
    });
  });

  it('returns null for malformed URLs rather than throwing', () => {
    expect(parseProxy('not a url')).toBeNull();
  });
});
