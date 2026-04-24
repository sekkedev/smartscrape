import { getPool } from '../config/database.js';
import type { ExtractedDataDTO } from '../db/runs.js';

export type FieldDiff = { field: string; old: unknown; new: unknown };

export type DiffResult = {
  current_run: { id: string; started_at: string };
  previous_run: { id: string; started_at: string } | null;
  added: Record<string, unknown>[];
  removed: Record<string, unknown>[];
  changed: {
    key: string | null;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    field_diffs: FieldDiff[];
  }[];
  comparison_key: string | null;
};

type DataRow = Pick<ExtractedDataDTO, 'source_url' | 'data' | 'data_hash' | 'created_at'>;

function fieldLevelDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldDiff[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: FieldDiff[] = [];
  for (const k of keys) {
    const a = before[k];
    const b = after[k];
    // Structural compare for objects/arrays; primitives compared with ===.
    const same =
      a === b || (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));
    if (!same) out.push({ field: k, old: a, new: b });
  }
  return out;
}

function indexByKey(
  rows: DataRow[],
  comparisonKey: string | null,
): Map<string, DataRow> {
  const map = new Map<string, DataRow>();
  for (const r of rows) {
    const key =
      comparisonKey && r.data[comparisonKey] != null
        ? String(r.data[comparisonKey])
        : r.data_hash;
    if (!map.has(key)) map.set(key, r);
  }
  return map;
}

/**
 * Diff the given run against the most recent earlier completed run for the same job.
 * Returns `previous_run: null` when there isn't one yet.
 */
export async function diffRun(userId: string, runId: string): Promise<DiffResult | null> {
  const pool = getPool();
  // Load the current run (and verify ownership via the scrape_jobs join).
  const { rows: currentRows } = await pool.query<{
    id: string;
    job_id: string;
    started_at: Date;
    comparison_key: string | null;
  }>(
    `SELECT r.id, r.job_id, r.started_at, j.comparison_key
       FROM scrape_runs r
       JOIN scrape_jobs j ON j.id = r.job_id AND j.user_id = $1
      WHERE r.id = $2
      LIMIT 1`,
    [userId, runId],
  );
  const current = currentRows[0];
  if (!current) return null;

  // Pick the previous completed run (excluding the current one).
  const { rows: prevRows } = await pool.query<{ id: string; started_at: Date }>(
    `SELECT id, started_at
       FROM scrape_runs
      WHERE job_id = $1 AND id <> $2 AND status = 'completed' AND started_at < $3
      ORDER BY started_at DESC
      LIMIT 1`,
    [current.job_id, current.id, current.started_at],
  );
  const prev = prevRows[0] ?? null;

  const { rows: curData } = await pool.query<DataRow>(
    `SELECT source_url, data, data_hash, created_at FROM extracted_data WHERE run_id = $1`,
    [current.id],
  );

  const result: DiffResult = {
    current_run: { id: current.id, started_at: current.started_at.toISOString() },
    previous_run: prev ? { id: prev.id, started_at: prev.started_at.toISOString() } : null,
    added: [],
    removed: [],
    changed: [],
    comparison_key: current.comparison_key,
  };

  if (!prev) {
    // First run ever \u2014 every item is "added" against an empty baseline.
    result.added = curData.map((r) => r.data);
    return result;
  }

  const { rows: prevData } = await pool.query<DataRow>(
    `SELECT source_url, data, data_hash, created_at FROM extracted_data WHERE run_id = $1`,
    [prev.id],
  );

  const key = current.comparison_key;
  const curByKey = indexByKey(curData, key);
  const prevByKey = indexByKey(prevData, key);

  for (const [k, row] of curByKey) {
    const match = prevByKey.get(k);
    if (!match) {
      result.added.push(row.data);
    } else if (row.data_hash !== match.data_hash && key) {
      result.changed.push({
        key: k,
        before: match.data,
        after: row.data,
        field_diffs: fieldLevelDiff(match.data, row.data),
      });
    }
  }
  for (const [k, row] of prevByKey) {
    if (!curByKey.has(k)) result.removed.push(row.data);
  }

  return result;
}
