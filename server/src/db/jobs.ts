import { getPool } from '../config/database.js';
import type { Provider } from './apiKeys.js';

export type ScrapeMethod = 'auto' | 'cheerio' | 'playwright';
export type SetupMethod = 'ai' | 'manual';

export type NotificationRule =
  | { type: 'any_change'; message?: string }
  | { type: 'new_items'; message?: string }
  | { type: 'removed_items'; message?: string }
  | {
      type: 'field_threshold';
      field: string;
      operator:
        | 'less_than'
        | 'greater_than'
        | 'equals'
        | 'not_equals'
        | 'less_than_or_equal'
        | 'greater_than_or_equal';
      value: number | string;
      message?: string;
    }
  | { type: 'field_change'; field: string; message?: string };

export type NotifyChannel = 'email' | 'telegram';

export type JobRow = {
  id: string;
  user_id: string;
  name: string;
  urls: string[];
  extraction_prompt: string;
  extraction_schema: Record<string, 'string' | 'number' | 'boolean' | 'array' | 'object'> | null;
  scrape_method: ScrapeMethod;
  schedule: string | null;
  enabled: boolean;
  notification_rules: NotificationRule[];
  notify_channels: NotifyChannel[];
  comparison_key: string | null;
  ai_provider: Provider;
  ai_model: string;
  google_sheet_id: string | null;
  sheet_tab_name: string | null;
  setup_method: SetupMethod;
  respect_robots_txt: boolean;
  webhook_url: string | null;
  /**
   * AES-256-GCM ciphertext of the user-supplied HMAC secret, or null. The
   * plaintext is never returned by the API after the initial write — the DTO
   * exposes `webhook_secret_configured: boolean` so the UI can show that one
   * is set without leaking it.
   */
  webhook_secret_encrypted: string | null;
  last_run_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type JobDTO = Omit<
  JobRow,
  'last_run_at' | 'created_at' | 'updated_at' | 'webhook_secret_encrypted'
> & {
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
  webhook_secret_configured: boolean;
};

export function toDTO(row: JobRow): JobDTO {
  // Strip the encrypted column from the wire shape — callers should only ever
  // see a boolean. Destructure it off before spreading.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { webhook_secret_encrypted, ...rest } = row;
  return {
    ...rest,
    webhook_secret_configured: row.webhook_secret_encrypted !== null,
    last_run_at: row.last_run_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export type CreateJobArgs = {
  name: string;
  urls: string[];
  extraction_prompt: string;
  extraction_schema: Record<string, 'string' | 'number' | 'boolean' | 'array' | 'object'> | null;
  scrape_method?: ScrapeMethod;
  schedule?: string | null;
  enabled?: boolean;
  notification_rules?: NotificationRule[];
  notify_channels?: NotifyChannel[];
  comparison_key?: string | null;
  ai_provider?: Provider;
  ai_model?: string;
  google_sheet_id?: string | null;
  sheet_tab_name?: string | null;
  setup_method?: SetupMethod;
  respect_robots_txt?: boolean;
  webhook_url?: string | null;
  webhook_secret_encrypted?: string | null;
};

export async function createJob(userId: string, args: CreateJobArgs): Promise<JobRow> {
  const { rows } = await getPool().query<JobRow>(
    `INSERT INTO scrape_jobs (
       user_id, name, urls, extraction_prompt, extraction_schema,
       scrape_method, schedule, enabled, notification_rules, notify_channels,
       comparison_key, ai_provider, ai_model, google_sheet_id, sheet_tab_name, setup_method,
       respect_robots_txt, webhook_url, webhook_secret_encrypted
     )
     VALUES ($1,$2,$3::jsonb,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING *`,
    [
      userId,
      args.name,
      JSON.stringify(args.urls),
      args.extraction_prompt,
      args.extraction_schema ? JSON.stringify(args.extraction_schema) : null,
      args.scrape_method ?? 'auto',
      args.schedule ?? null,
      args.enabled ?? true,
      JSON.stringify(args.notification_rules ?? []),
      JSON.stringify(args.notify_channels ?? []),
      args.comparison_key ?? null,
      args.ai_provider ?? 'openrouter',
      args.ai_model ?? 'openai/gpt-4o-mini',
      args.google_sheet_id ?? null,
      args.sheet_tab_name ?? null,
      args.setup_method ?? 'manual',
      args.respect_robots_txt ?? true,
      args.webhook_url ?? null,
      args.webhook_secret_encrypted ?? null,
    ],
  );
  return rows[0]!;
}

export type ListOpts = {
  filter?: 'all' | 'active' | 'paused' | 'failed';
  limit?: number;
  offset?: number;
};

export type JobListItem = JobDTO & {
  last_run_status: string | null;
  last_run_items: number | null;
};

export async function listJobs(
  userId: string,
  opts: ListOpts = {},
): Promise<{ items: JobListItem[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  let where = `WHERE j.user_id = $1`;
  const vals: unknown[] = [userId];
  if (opts.filter === 'active') where += ` AND j.enabled = true`;
  else if (opts.filter === 'paused') where += ` AND j.enabled = false`;
  // "failed" is evaluated after the LATERAL join so we add it below.

  const sql = `
    SELECT j.*, lr.status AS last_run_status, lr.items_extracted AS last_run_items
      FROM scrape_jobs j
      LEFT JOIN LATERAL (
        SELECT status, items_extracted
          FROM scrape_runs
         WHERE job_id = j.id
         ORDER BY started_at DESC
         LIMIT 1
      ) lr ON true
      ${where}
      ${opts.filter === 'failed' ? `AND lr.status = 'failed'` : ''}
      ORDER BY j.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`;
  const { rows } = await getPool().query<
    JobRow & { last_run_status: string | null; last_run_items: number | null }
  >(sql, vals);
  const items = rows.map((r) => ({
    ...toDTO(r),
    last_run_status: r.last_run_status,
    last_run_items: r.last_run_items,
  }));

  const countSql = `
    SELECT COUNT(*)::int AS total
      FROM scrape_jobs j
      LEFT JOIN LATERAL (
        SELECT status FROM scrape_runs WHERE job_id = j.id ORDER BY started_at DESC LIMIT 1
      ) lr ON true
      ${where}
      ${opts.filter === 'failed' ? `AND lr.status = 'failed'` : ''}`;
  const { rows: crows } = await getPool().query<{ total: number }>(countSql, vals);
  return { items, total: crows[0]?.total ?? 0 };
}

export async function findJob(userId: string, jobId: string): Promise<JobRow | null> {
  const { rows } = await getPool().query<JobRow>(
    `SELECT * FROM scrape_jobs WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [jobId, userId],
  );
  return rows[0] ?? null;
}

export type UpdateJobArgs = Partial<CreateJobArgs>;

export async function updateJob(
  userId: string,
  jobId: string,
  args: UpdateJobArgs,
): Promise<JobRow | null> {
  // Build dynamic SET clause only for provided keys.
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, value: unknown, jsonb = false) => {
    vals.push(value);
    sets.push(`${col} = $${vals.length}${jsonb ? '::jsonb' : ''}`);
  };
  if (args.name !== undefined) push('name', args.name);
  if (args.urls !== undefined) push('urls', JSON.stringify(args.urls), true);
  if (args.extraction_prompt !== undefined) push('extraction_prompt', args.extraction_prompt);
  if (args.extraction_schema !== undefined)
    push(
      'extraction_schema',
      args.extraction_schema ? JSON.stringify(args.extraction_schema) : null,
      true,
    );
  if (args.scrape_method !== undefined) push('scrape_method', args.scrape_method);
  if (args.schedule !== undefined) push('schedule', args.schedule);
  if (args.enabled !== undefined) push('enabled', args.enabled);
  if (args.notification_rules !== undefined)
    push('notification_rules', JSON.stringify(args.notification_rules), true);
  if (args.notify_channels !== undefined)
    push('notify_channels', JSON.stringify(args.notify_channels), true);
  if (args.comparison_key !== undefined) push('comparison_key', args.comparison_key);
  if (args.ai_provider !== undefined) push('ai_provider', args.ai_provider);
  if (args.ai_model !== undefined) push('ai_model', args.ai_model);
  if (args.google_sheet_id !== undefined) push('google_sheet_id', args.google_sheet_id);
  if (args.sheet_tab_name !== undefined) push('sheet_tab_name', args.sheet_tab_name);
  if (args.respect_robots_txt !== undefined) push('respect_robots_txt', args.respect_robots_txt);
  if (args.webhook_url !== undefined) push('webhook_url', args.webhook_url);
  if (args.webhook_secret_encrypted !== undefined)
    push('webhook_secret_encrypted', args.webhook_secret_encrypted);

  if (sets.length === 0) return findJob(userId, jobId);

  vals.push(userId, jobId);
  const { rows } = await getPool().query<JobRow>(
    `UPDATE scrape_jobs SET ${sets.join(', ')}
      WHERE user_id = $${vals.length - 1} AND id = $${vals.length}
      RETURNING *`,
    vals,
  );
  return rows[0] ?? null;
}

export async function toggleJob(userId: string, jobId: string): Promise<JobRow | null> {
  const { rows } = await getPool().query<JobRow>(
    `UPDATE scrape_jobs SET enabled = NOT enabled
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [jobId, userId],
  );
  return rows[0] ?? null;
}

export async function deleteJob(userId: string, jobId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `DELETE FROM scrape_jobs WHERE id = $1 AND user_id = $2`,
    [jobId, userId],
  );
  return (rowCount ?? 0) > 0;
}
