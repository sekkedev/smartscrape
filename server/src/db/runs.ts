import { getPool } from '../config/database.js';
import type { ErrorType } from '../lib/error-classifier.js';

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
  error_type: ErrorType | null;
  export_error: string | null;
  started_at: Date;
  completed_at: Date | null;
  webhook_status: 'success' | 'failed' | null;
  webhook_attempts: number;
  webhook_last_error: string | null;
  webhook_delivered_at: Date | null;
  /** BullMQ job id that produced this run; null for pre-migration rows. */
  queue_job_id: string | null;
};

export type RunDTO = Omit<RunRow, 'started_at' | 'completed_at' | 'webhook_delivered_at'> & {
  started_at: string;
  completed_at: string | null;
  webhook_delivered_at: string | null;
};

export function toDTO(r: RunRow): RunDTO {
  return {
    ...r,
    started_at: r.started_at.toISOString(),
    completed_at: r.completed_at?.toISOString() ?? null,
    webhook_delivered_at: r.webhook_delivered_at?.toISOString() ?? null,
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

/** Count runs for a user in the last 24h (rolling window). Used for the daily quota. */
export async function countRunsLast24h(userId: string): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM scrape_runs r
       JOIN scrape_jobs j ON j.id = r.job_id
      WHERE j.user_id = $1 AND r.started_at > now() - interval '24 hours'`,
    [userId],
  );
  return Number.parseInt(rows[0]?.count ?? '0', 10);
}

export async function createRun(jobId: string, queueJobId?: string | null): Promise<RunRow> {
  const { rows } = await getPool().query<RunRow>(
    `INSERT INTO scrape_runs (job_id, status, queue_job_id) VALUES ($1, 'pending', $2) RETURNING *`,
    [jobId, queueJobId ?? null],
  );
  return rows[0]!;
}

/**
 * Find the run created for a specific BullMQ job id. Lets a stalled-job retry
 * attach to the run the crashed attempt already created instead of opening a
 * duplicate row.
 */
export async function findRunByQueueJobId(queueJobId: string): Promise<RunRow | null> {
  const { rows } = await getPool().query<RunRow>(
    `SELECT * FROM scrape_runs WHERE queue_job_id = $1 LIMIT 1`,
    [queueJobId],
  );
  return rows[0] ?? null;
}

/**
 * Find-or-create the run for a BullMQ job id, atomically. The partial UNIQUE
 * index on queue_job_id makes concurrent inserts collapse to one row: the
 * loser's INSERT hits ON CONFLICT DO NOTHING and re-reads the winner. This
 * prevents duplicate run rows when a stalled job is re-processed while (or
 * just after) the original attempt was still creating its run.
 */
export async function findOrCreateRunForQueueJob(
  jobId: string,
  queueJobId: string,
): Promise<RunRow> {
  const { rows } = await getPool().query<RunRow>(
    `INSERT INTO scrape_runs (job_id, status, queue_job_id)
       VALUES ($1, 'pending', $2)
       ON CONFLICT (queue_job_id) WHERE queue_job_id IS NOT NULL DO NOTHING
       RETURNING *`,
    [jobId, queueJobId],
  );
  if (rows[0]) return rows[0];
  const existing = await findRunByQueueJobId(queueJobId);
  if (existing) return existing;
  throw new Error(`Could not find or create run for queue job ${queueJobId}`);
}

/**
 * Close out runs stuck in a non-terminal status for longer than the
 * threshold — the signature a crash or restart leaves behind. Returns the
 * number of runs swept. `error_type = 'interrupted'` keeps them out of the
 * auto-pause failure streak (see services/auto-pause.ts).
 */
export async function sweepStaleRuns(olderThanMs: number): Promise<number> {
  const { rowCount } = await getPool().query(
    `UPDATE scrape_runs
        SET status = 'failed',
            error_message = 'Run interrupted — the server crashed or restarted mid-run',
            error_type = 'interrupted',
            completed_at = now()
      WHERE status IN ('pending', 'scraping', 'extracting', 'exporting')
        AND started_at < now() - ($1 * interval '1 millisecond')`,
    [olderThanMs],
  );
  return rowCount ?? 0;
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
      | 'error_type'
      | 'export_error'
      | 'completed_at'
      | 'webhook_status'
      | 'webhook_attempts'
      | 'webhook_last_error'
      | 'webhook_delivered_at'
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
  if (patch.error_type !== undefined) push('error_type', patch.error_type);
  if (patch.export_error !== undefined) push('export_error', patch.export_error);
  if (patch.completed_at !== undefined) push('completed_at', patch.completed_at);
  if (patch.webhook_status !== undefined) push('webhook_status', patch.webhook_status);
  if (patch.webhook_attempts !== undefined) push('webhook_attempts', patch.webhook_attempts);
  if (patch.webhook_last_error !== undefined) push('webhook_last_error', patch.webhook_last_error);
  if (patch.webhook_delivered_at !== undefined)
    push('webhook_delivered_at', patch.webhook_delivered_at);
  if (sets.length === 0) return;
  vals.push(runId);
  await getPool().query(
    `UPDATE scrape_runs SET ${sets.join(', ')} WHERE id = $${vals.length}`,
    vals,
  );
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

export async function listDataForRun(userId: string, runId: string): Promise<ExtractedDataDTO[]> {
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
