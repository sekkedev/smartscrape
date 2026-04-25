import { describe, it, expect } from 'vitest';
import { toCsv } from './csv.js';

describe('toCsv', () => {
  it('returns empty string for no rows', () => {
    expect(toCsv([])).toBe('');
  });

  it('writes a header row from union of keys in the first peek rows', () => {
    const out = toCsv([{ a: 1, b: 2 }]);
    const lines = out.split('\r\n');
    expect(lines[0]).toBe('a,b');
    expect(lines[1]).toBe('1,2');
  });

  it('quotes values that contain commas, quotes, or newlines', () => {
    const out = toCsv([{ s: 'a,b' }, { s: 'with "quote"' }, { s: 'two\nlines' }]);
    expect(out).toContain('"a,b"');
    expect(out).toContain('"with ""quote"""');
    expect(out).toContain('"two\nlines"');
  });

  it('serialises objects and arrays as JSON', () => {
    const out = toCsv([{ data: { k: 'v' } }, { data: [1, 2] }]);
    // Object/array serialisations contain commas → end up quoted.
    expect(out).toContain('"{""k"":""v""}"');
    expect(out).toContain('"[1,2]"');
  });

  describe('formula-injection neutralization', () => {
    // Each leading char Excel/Sheets interprets as a formula: = + - @ \t \r
    it.each([
      ['=cmd|"/c calc"!A1', '\'=cmd|"/c calc"!A1'],
      ['+danger', "'+danger"],
      ['-1+1', "'-1+1"],
      ['@SUM(A1:A2)', "'@SUM(A1:A2)"],
      ['\ttabbed', "'\ttabbed"],
      ['\rcarriage', "'\rcarriage"],
    ])('prefixes leading %s with apostrophe', (input, expected) => {
      const out = toCsv([{ field: input }]);
      // Header line is "field\r\n", second is the neutralized value (possibly quoted).
      const valueLine = out.split('\r\n')[1] ?? '';
      // Strip outer quotes if the field was wrapped due to special chars.
      const unwrapped =
        valueLine.startsWith('"') && valueLine.endsWith('"')
          ? valueLine.slice(1, -1).replace(/""/g, '"')
          : valueLine;
      expect(unwrapped).toBe(expected);
    });

    it('does NOT neutralize values where the formula char is mid-string', () => {
      const out = toCsv([{ s: 'price=10' }]);
      expect(out).toContain('price=10');
      expect(out).not.toContain("'price=10");
    });

    it('null and undefined become empty cells, not neutralized', () => {
      const out = toCsv([{ a: null, b: undefined, c: '' }]);
      const line = out.split('\r\n')[1];
      expect(line).toBe(',,');
    });
  });

  it('keys missing from a row become empty cells (sparse rows)', () => {
    const out = toCsv([{ a: 1, b: 2 }, { a: 3 }]);
    const lines = out.split('\r\n');
    expect(lines[0]).toBe('a,b');
    expect(lines[1]).toBe('1,2');
    expect(lines[2]).toBe('3,');
  });
});
