import { getPool } from '../config/database.js';

export type RunStatus =
  | 'pending'
  | 'scraping'
  | 'extracting'
  | 'exporting'
  | 'completed'
  | 'failed';

export type RunRow = {
  id: string;
  job_id: string;
  status: RunStatus;
  urls_scraped: number;
  items_extracted: number;
  tokens_used: number;
  error_message: string | null;
  export_error: string | null;
  started_at: Date;
  completed_at: Date | null;
};

export type RunDTO = Omit<RunRow, 'started_at' | 'completed_at'> & {
  started_at: string;
  completed_at: string | null;
};

export function toDTO(r: RunRow): RunDTO {
  return {
    ...r,
    started_at: r.started_at.toISOString(),
    completed_at: r.completed_at?.toISOString() ?? null,
  };
}

export async function listRunsForJob(
  userId: string,
  jobId: string,
  limit = 50,
  offset = 0,
): Promise<RunDTO[]> {
  const { rows } = await getPool().query<RunRow>(
    `SELECT r.*
       FROM scrape_runs r
       JOIN scrape_jobs j ON j.id = r.job_id AND j.user_id = $1
      WHERE r.job_id = $2
      ORDER BY r.started_at DESC
      LIMIT $3 OFFSET $4`,
    [userId, jobId, limit, offset],
  );
  return rows.map(toDTO);
}

export async function findRun(userId: string, runId: string): Promise<RunRow | null> {
  const { rows } = await getPool().query<RunRow>(
    `SELECT r.*
       FROM scrape_runs r
       JOIN scrape_jobs j ON j.id = r.job_id AND j.user_id = $1
      WHERE r.id = $2
      LIMIT 1`,
    [userId, runId],
  );
  return rows[0] ?? null;
}

export async function createRun(jobId: string): Promise<RunRow> {
  const { rows } = await getPool().query<RunRow>(
    `INSERT INTO scrape_runs (job_id, status) VALUES ($1, 'pending') RETURNING *`,
    [jobId],
  );
  return rows[0]!;
}

export async function updateRun(
  runId: string,
  patch: Partial<
    Pick<
      RunRow,
      | 'status'
      | 'urls_scraped'
      | 'items_extracted'
      | 'tokens_used'
      | 'error_message'
      | 'export_error'
      | 'completed_at'
    >
  >,
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, v: unknown) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  };
  if (patch.status !== undefined) push('status', patch.status);
  if (patch.urls_scraped !== undefined) push('urls_scraped', patch.urls_scraped);
  if (patch.items_extracted !== undefined) push('items_extracted', patch.items_extracted);
  if (patch.tokens_used !== undefined) push('tokens_used', patch.tokens_used);
  if (patch.error_message !== undefined) push('error_message', patch.error_message);
  if (patch.export_error !== undefined) push('export_error', patch.export_error);
  if (patch.completed_at !== undefined) push('completed_at', patch.completed_at);
  if (sets.length === 0) return;
  vals.push(runId);
  await getPool().query(`UPDATE scrape_runs SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
}

export type ExtractedDataRow = {
  id: string;
  run_id: string;
  job_id: string;
  source_url: string;
  data: Record<string, unknown>;
  data_hash: string;
  created_at: Date;
};

export type ExtractedDataDTO = Omit<ExtractedDataRow, 'created_at'> & { created_at: string };

export async function listDataForRun(
  userId: string,
  runId: string,
): Promise<ExtractedDataDTO[]> {
  const { rows } = await getPool().query<ExtractedDataRow>(
    `SELECT d.*
       FROM extracted_data d
       JOIN scrape_jobs j ON j.id = d.job_id AND j.user_id = $1
      WHERE d.run_id = $2
      ORDER BY d.source_url, d.created_at`,
    [userId, runId],
  );
  return rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
}

export async function insertExtractedData(
  runId: string,
  jobId: string,
  rows: { source_url: string; data: Record<string, unknown>; data_hash: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  const values: unknown[] = [];
  const placeholders = rows.map((r, i) => {
    const base = i * 5;
    values.push(runId, jobId, r.source_url, JSON.stringify(r.data), r.data_hash);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb, $${base + 5})`;
  });
  await getPool().query(
    `INSERT INTO extracted_data (run_id, job_id, source_url, data, data_hash) VALUES ${placeholders.join(', ')}`,
    values,
  );
}
