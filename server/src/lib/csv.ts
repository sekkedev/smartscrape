/**
 * Serialize objects to RFC-4180 CSV. Column order comes from the union of all
 * keys in the first N rows so rare fields aren't silently dropped.
 */
export function toCsv(rows: Record<string, unknown>[], opts: { peek?: number } = {}): string {
  if (rows.length === 0) return '';
  const peek = opts.peek ?? Math.min(rows.length, 50);
  const keys: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < peek; i++) {
    const row = rows[i];
    if (!row) continue;
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  const lines: string[] = [keys.map(csvField).join(',')];
  for (const row of rows) {
    lines.push(keys.map((k) => csvField(row[k])).join(','));
  }
  // CRLF per RFC 4180.
  return lines.join('\r\n') + '\r\n';
}

function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
