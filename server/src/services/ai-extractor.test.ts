import { describe, it, expect } from 'vitest';
import { hashItem, parseItems, validateExtractedItems } from './ai-extractor.js';

describe('parseItems', () => {
  it('parses a raw JSON array', () => {
    expect(parseItems('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('strips ```json ... ``` fences', () => {
    expect(parseItems('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
    expect(parseItems('```\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
  });

  it('unwraps an object with items / data / results / rows key', () => {
    expect(parseItems('{"items":[{"a":1}]}')).toEqual([{ a: 1 }]);
    expect(parseItems('{"data":[{"a":1}]}')).toEqual([{ a: 1 }]);
    expect(parseItems('{"results":[{"a":1}]}')).toEqual([{ a: 1 }]);
    expect(parseItems('{"rows":[{"a":1}]}')).toEqual([{ a: 1 }]);
  });

  it('returns null for invalid JSON', () => {
    expect(parseItems('not json')).toBeNull();
    expect(parseItems('{not: valid}')).toBeNull();
    expect(parseItems('')).toBeNull();
  });

  it('returns null for non-array root with no recognized wrapper key', () => {
    expect(parseItems('{"foo":[{"a":1}]}')).toBeNull();
    expect(parseItems('"a string"')).toBeNull();
    expect(parseItems('42')).toBeNull();
  });
});

describe('hashItem', () => {
  it('returns a hex SHA-256', () => {
    const h = hashItem({ a: 1 });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same JSON shape', () => {
    expect(hashItem({ a: 1 })).toBe(hashItem({ a: 1 }));
  });

  it('changes when the value changes', () => {
    expect(hashItem({ a: 1 })).not.toBe(hashItem({ a: 2 }));
  });
});

describe('validateExtractedItems', () => {
  const SIZE = 16_384;

  describe('schema type check', () => {
    it('passes when every field matches the declared type', () => {
      const r = validateExtractedItems([{ name: 'x', price: 9.99, in_stock: true }], {
        extractionSchema: { name: 'string', price: 'number', in_stock: 'boolean' },
        sizeCap: SIZE,
      });
      expect(r.ok).toBe(true);
    });

    it('fails on string-where-number', () => {
      const r = validateExtractedItems([{ price: '9.99' }], {
        extractionSchema: { price: 'number' },
        sizeCap: SIZE,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/price.*number/i);
    });

    it('treats null/undefined as permissive (optional fields)', () => {
      const r = validateExtractedItems([{ price: null }, { price: undefined }], {
        extractionSchema: { price: 'number' },
        sizeCap: SIZE,
      });
      expect(r.ok).toBe(true);
    });

    it('rejects non-finite numbers', () => {
      const r = validateExtractedItems([{ price: NaN }], {
        extractionSchema: { price: 'number' },
        sizeCap: SIZE,
      });
      expect(r.ok).toBe(false);
    });

    it('distinguishes object from array for type=object', () => {
      const ok = validateExtractedItems([{ meta: { k: 'v' } }], {
        extractionSchema: { meta: 'object' },
        sizeCap: SIZE,
      });
      expect(ok.ok).toBe(true);
      const bad = validateExtractedItems([{ meta: [1, 2] }], {
        extractionSchema: { meta: 'object' },
        sizeCap: SIZE,
      });
      expect(bad.ok).toBe(false);
    });
  });

  describe('secret-leak guard', () => {
    const longKey = 'sk-or-v1-abcdefghijklmnopqrstuvwxyz';
    const shortKey = 'short'; // < 16 chars

    it('rejects items containing a real-length API key', () => {
      const r = validateExtractedItems([{ note: `My token: ${longKey} oops` }], {
        apiKeyGuards: [longKey],
        sizeCap: SIZE,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/restricted/i);
    });

    it('skips API-key guards shorter than the 16-char floor (false-positive prevention)', () => {
      const r = validateExtractedItems(
        [{ note: `text containing ${shortKey} as legitimate content` }],
        { apiKeyGuards: [shortKey], sizeCap: SIZE },
      );
      expect(r.ok).toBe(true);
    });

    it('rejects items containing a short email (no length floor on emails)', () => {
      const r = validateExtractedItems([{ note: 'contact: a@b.co for details' }], {
        emailGuards: ['a@b.co'],
        sizeCap: SIZE,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/restricted/i);
    });

    it('passes when neither guard list contains a substring of the items', () => {
      const r = validateExtractedItems([{ note: 'innocuous content' }], {
        apiKeyGuards: [longKey],
        emailGuards: ['user@example.com'],
        sizeCap: SIZE,
      });
      expect(r.ok).toBe(true);
    });

    it('ignores empty / undefined guard entries', () => {
      const r = validateExtractedItems([{ note: 'x' }], {
        apiKeyGuards: ['', longKey],
        emailGuards: [''],
        sizeCap: SIZE,
      });
      expect(r.ok).toBe(true);
    });
  });

  describe('size cap', () => {
    it('rejects items larger than the cap', () => {
      const huge = 'x'.repeat(200);
      const r = validateExtractedItems([{ blob: huge }], { sizeCap: 100 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/size cap/i);
    });

    it('accepts items at or below the cap', () => {
      const r = validateExtractedItems([{ blob: 'x' }], { sizeCap: 100 });
      expect(r.ok).toBe(true);
    });
  });

  describe('sanitize (HTML escaping)', () => {
    it('escapes HTML in string leaves', () => {
      const r = validateExtractedItems([{ name: '<script>alert(1)</script>' }], { sizeCap: SIZE });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const cleaned = String(r.items[0]!.name);
        expect(cleaned).not.toContain('<script>');
        expect(cleaned).toContain('&lt;script&gt;');
      }
    });

    it('recurses into arrays and nested objects', () => {
      const r = validateExtractedItems([{ tags: ['<b>', '<i>'], meta: { html: '<p>x</p>' } }], {
        sizeCap: SIZE,
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const item = r.items[0]!;
        expect(JSON.stringify(item)).not.toContain('<b>');
        expect(JSON.stringify(item)).toContain('&lt;b&gt;');
      }
    });

    it('leaves non-string leaves alone', () => {
      const r = validateExtractedItems([{ price: 9.99, in_stock: true, tags: null }], {
        sizeCap: SIZE,
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.items[0]).toEqual({ price: 9.99, in_stock: true, tags: null });
      }
    });
  });
});
