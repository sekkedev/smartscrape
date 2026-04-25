import { Router } from 'express';
import { z } from 'zod';
import { assertSafeUrl } from '../lib/ssrf.js';
import { validateCron } from '../lib/cron.js';
import { fail, ok } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  aiSetupLimiter,
  runTriggerLimiter,
  sheetsPushLimiter,
  userGeneralLimiter,
} from '../middleware/rateLimit.js';
import {
  createJob,
  deleteJob,
  findJob,
  listJobs,
  toDTO as toJobDTO,
  toggleJob,
  updateJob,
} from '../db/jobs.js';
import { countRunsLast24h, listDataForRun, listRunsForJob } from '../db/runs.js';
import { DAILY_RUN_QUOTA } from '../services/job-runner.js';
import { toCsv } from '../lib/csv.js';
import { findForUser as findApiKey, type Provider as ProviderName } from '../db/apiKeys.js';
import { decrypt } from '../config/encryption.js';
import { scrape } from '../services/scraper.js';
import { suggest } from '../services/ai-setup.js';
import { extract } from '../services/ai-extractor.js';
import { enqueueNow, syncSchedule } from '../services/job-queue.js';
import { pushRows } from '../services/google-sheets.js';
import { findConnection } from '../db/googleConnections.js';
import { createRun, toDTO as toRunDTO } from '../db/runs.js';
import { getPool } from '../config/database.js';

export const jobsRouter = Router();
jobsRouter.use(requireAuth);
// Per-user general cap (100/min). Specific routes layer tighter limits below.
jobsRouter.use(userGeneralLimiter);

// ---------- schemas ----------

const providerEnum = z.enum(['openai', 'anthropic', 'openrouter']);
const scrapeMethodEnum = z.enum(['auto', 'playwright', 'cheerio']);
const setupMethodEnum = z.enum(['ai', 'manual']);
const channelEnum = z.enum(['email', 'telegram']);

const notificationRule = z.discriminatedUnion('type', [
  z.object({ type: z.literal('any_change'), message: z.string().optional() }),
  z.object({ type: z.literal('new_items'), message: z.string().optional() }),
  z.object({ type: z.literal('removed_items'), message: z.string().optional() }),
  z.object({
    type: z.literal('field_threshold'),
    field: z.string().min(1),
    operator: z.enum([
      'less_than',
      'greater_than',
      'equals',
      'not_equals',
      'less_than_or_equal',
      'greater_than_or_equal',
    ]),
    value: z.union([z.number(), z.string()]),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal('field_change'),
    field: z.string().min(1),
    message: z.string().optional(),
  }),
]);

const extractionSchema = z.record(z.enum(['string', 'number', 'boolean', 'array', 'object']));

const createBody = z.object({
  name: z.string().trim().min(1).max(200),
  urls: z.array(z.string().url()).min(1).max(10),
  extraction_prompt: z.string().trim().min(5).max(5000),
  extraction_schema: extractionSchema.nullable().optional(),
  scrape_method: scrapeMethodEnum.optional(),
  schedule: z
    .string()
    .nullable()
    .optional()
    .refine(
      (v) => {
        if (v === null || v === undefined || v === '') return true;
        return validateCron(v).ok;
      },
      (v) => ({
        message: v && validateCron(v).ok === false
          ? (validateCron(v) as { reason: string }).reason
          : 'Invalid cron',
      }),
    ),
  enabled: z.boolean().optional(),
  notification_rules: z.array(notificationRule).optional(),
  notify_channels: z.array(channelEnum).optional(),
  comparison_key: z.string().nullable().optional(),
  ai_provider: providerEnum.optional(),
  ai_model: z.string().min(1).max(120).optional(),
  google_sheet_id: z.string().nullable().optional(),
  sheet_tab_name: z.string().nullable().optional(),
  setup_method: setupMethodEnum.optional(),
});

const updateBody = createBody.partial();

const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  filter: z.enum(['all', 'active', 'paused', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ---------- helpers ----------

async function validateAllUrls(urls: string[]): Promise<string | null> {
  for (const u of urls) {
    const r = await assertSafeUrl(u);
    if (!r.ok) return `${u}: ${r.reason}`;
  }
  return null;
}

// ---------- routes ----------

const aiSetupBody = z.object({
  url: z.string().url(),
  goal: z.string().trim().min(3).max(2000),
  ai_provider: providerEnum.optional(),
  ai_model: z.string().min(1).max(120).optional(),
});

const aiPreviewBody = z.object({
  url: z.string().url(),
  extraction_prompt: z.string().trim().min(3).max(5000),
  extraction_schema: extractionSchema.nullable().optional(),
  ai_provider: providerEnum.optional(),
  ai_model: z.string().min(1).max(120).optional(),
});

const aiConfirmBody = createBody.extend({
  user_goal: z.string().trim().min(1).max(2000),
  ai_suggestion: z.record(z.unknown()),
});

async function resolveProviderKey(
  userId: string,
  provider: ProviderName,
): Promise<{ ok: true; key: string } | { ok: false; status: number; code: string; message: string }> {
  const row = await findApiKey(userId, provider);
  if (!row) {
    return { ok: false, status: 400, code: 'NO_PROVIDER_KEY', message: `No ${provider} key configured. Add one in Settings.` };
  }
  try {
    return { ok: true, key: decrypt(row.api_key_encrypted) };
  } catch {
    return { ok: false, status: 500, code: 'DECRYPT_FAILED', message: 'Stored key could not be decrypted' };
  }
}

jobsRouter.post('/ai-setup', aiSetupLimiter, validate(aiSetupBody), async (req, res) => {
  const body = req.body as z.infer<typeof aiSetupBody>;
  const safety = await assertSafeUrl(body.url);
  if (!safety.ok) {
    res.status(400).json(fail('UNSAFE_URL', safety.reason));
    return;
  }
  const provider = body.ai_provider ?? 'openrouter';
  const keyRes = await resolveProviderKey(req.user!.id, provider);
  if (!keyRes.ok) {
    res.status(keyRes.status).json(fail(keyRes.code, keyRes.message));
    return;
  }
  let page;
  try {
    page = await scrape(body.url);
  } catch (err) {
    res.status(502).json(fail('SCRAPE_FAILED', err instanceof Error ? err.message : 'Scrape failed'));
    return;
  }
  const result = await suggest({
    provider,
    apiKey: keyRes.key,
    model: body.ai_model ?? 'openai/gpt-4o-mini',
    cleanedHtml: page.cleaned,
    userGoal: body.goal,
  });
  if (!result.ok) {
    res.status(502).json(fail('AI_SETUP_FAILED', result.error));
    return;
  }
  res.status(200).json(
    ok({
      suggestion: result.suggestion,
      usage: result.usage,
      scrape: { method: page.method, status: page.status, finalUrl: page.finalUrl, durationMs: page.durationMs },
    }),
  );
});

jobsRouter.post('/ai-setup/preview', aiSetupLimiter, validate(aiPreviewBody), async (req, res) => {
  const body = req.body as z.infer<typeof aiPreviewBody>;
  const safety = await assertSafeUrl(body.url);
  if (!safety.ok) {
    res.status(400).json(fail('UNSAFE_URL', safety.reason));
    return;
  }
  const provider = body.ai_provider ?? 'openrouter';
  const keyRes = await resolveProviderKey(req.user!.id, provider);
  if (!keyRes.ok) {
    res.status(keyRes.status).json(fail(keyRes.code, keyRes.message));
    return;
  }
  let page;
  try {
    page = await scrape(body.url);
  } catch (err) {
    res.status(502).json(fail('SCRAPE_FAILED', err instanceof Error ? err.message : 'Scrape failed'));
    return;
  }
  const result = await extract({
    provider,
    apiKey: keyRes.key,
    model: body.ai_model ?? 'openai/gpt-4o-mini',
    cleanedHtml: page.cleaned,
    extractionPrompt: body.extraction_prompt,
    extractionSchema: body.extraction_schema ?? undefined,
  });
  if (!result.ok) {
    res.status(502).json(fail('EXTRACT_FAILED', result.error));
    return;
  }
  res.status(200).json(ok({ items: result.items.slice(0, 20), usage: result.usage }));
});

jobsRouter.post('/ai-setup/confirm', validate(aiConfirmBody), async (req, res) => {
  const body = req.body as z.infer<typeof aiConfirmBody>;
  const bad = await validateAllUrls(body.urls);
  if (bad) {
    res.status(400).json(fail('UNSAFE_URL', bad));
    return;
  }
  const { user_goal, ai_suggestion, ...jobArgs } = body;
  const job = await createJob(req.user!.id, {
    ...jobArgs,
    extraction_schema: jobArgs.extraction_schema ?? null,
    setup_method: 'ai',
  });
  await getPool().query(
    `INSERT INTO job_setup_logs (job_id, user_goal, ai_suggestion, accepted) VALUES ($1, $2, $3::jsonb, true)`,
    [job.id, user_goal, JSON.stringify(ai_suggestion)],
  );
  res.status(201).json(ok({ job: toJobDTO(job) }));
});

jobsRouter.get('/', validate(listQuery, 'query'), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof listQuery>;
  const result = await listJobs(req.user!.id, {
    filter: q.filter ?? 'all',
    limit: q.limit,
    offset: q.offset,
  });
  res.status(200).json(ok(result));
});

jobsRouter.post('/', validate(createBody), async (req, res) => {
  const body = req.body as z.infer<typeof createBody>;
  const bad = await validateAllUrls(body.urls);
  if (bad) {
    res.status(400).json(fail('UNSAFE_URL', bad));
    return;
  }
  const row = await createJob(req.user!.id, {
    ...body,
    extraction_schema: body.extraction_schema ?? null,
  });
  await syncSchedule({ jobId: row.id, userId: row.user_id, enabled: row.enabled, schedule: row.schedule });
  res.status(201).json(ok({ job: toJobDTO(row) }));
});

jobsRouter.get('/:id', validate(idParam, 'params'), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParam>;
  const row = await findJob(req.user!.id, id);
  if (!row) {
    res.status(404).json(fail('NOT_FOUND', 'Job not found'));
    return;
  }
  res.status(200).json(ok({ job: toJobDTO(row) }));
});

jobsRouter.patch('/:id', validate(idParam, 'params'), validate(updateBody), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParam>;
  const body = req.body as z.infer<typeof updateBody>;
  if (body.urls) {
    const bad = await validateAllUrls(body.urls);
    if (bad) {
      res.status(400).json(fail('UNSAFE_URL', bad));
      return;
    }
  }
  const row = await updateJob(req.user!.id, id, body);
  if (!row) {
    res.status(404).json(fail('NOT_FOUND', 'Job not found'));
    return;
  }
  await syncSchedule({ jobId: row.id, userId: row.user_id, enabled: row.enabled, schedule: row.schedule });
  res.status(200).json(ok({ job: toJobDTO(row) }));
});

jobsRouter.patch('/:id/toggle', validate(idParam, 'params'), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParam>;
  const row = await toggleJob(req.user!.id, id);
  if (!row) {
    res.status(404).json(fail('NOT_FOUND', 'Job not found'));
    return;
  }
  await syncSchedule({ jobId: row.id, userId: row.user_id, enabled: row.enabled, schedule: row.schedule });
  res.status(200).json(ok({ job: toJobDTO(row) }));
});

jobsRouter.delete('/:id', validate(idParam, 'params'), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParam>;
  // Clear any scheduled repeatable for this job before deleting.
  await syncSchedule({ jobId: id, userId: req.user!.id, enabled: false, schedule: null });
  const removed = await deleteJob(req.user!.id, id);
  if (!removed) {
    res.status(404).json(fail('NOT_FOUND', 'Job not found'));
    return;
  }
  res.status(200).json(ok({ removed: true }));
});

jobsRouter.post('/:id/run', runTriggerLimiter, validate(idParam, 'params'), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParam>;
  const job = await findJob(req.user!.id, id);
  if (!job) {
    res.status(404).json(fail('NOT_FOUND', 'Job not found'));
    return;
  }
  const recent = await countRunsLast24h(req.user!.id);
  if (recent >= DAILY_RUN_QUOTA) {
    res.status(429).json(
      fail('QUOTA_EXCEEDED', `Daily run quota reached (${DAILY_RUN_QUOTA}/24h). Try again later.`),
    );
    return;
  }
  const run = await createRun(job.id);
  await enqueueNow({ jobId: job.id, userId: job.user_id, runId: run.id });
  res.status(202).json(ok({ run: toRunDTO(run) }));
});

async function sendCsvForRun(res: import('express').Response, jobId: string, runId: string, userId: string, jobName: string): Promise<void> {
  const rows = await listDataForRun(userId, runId);
  const csv = toCsv(rows.map((r) => ({ source_url: r.source_url, extracted_at: r.created_at, ...r.data })));
  const safeName = jobName.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60) || 'export';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeName}-${runId.slice(0, 8)}.csv"`,
  );
  res.status(200).send(csv);
  void jobId;
}

jobsRouter.get('/:id/export/csv', validate(idParam, 'params'), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParam>;
  const job = await findJob(req.user!.id, id);
  if (!job) {
    res.status(404).json(fail('NOT_FOUND', 'Job not found'));
    return;
  }
  const runs = await listRunsForJob(req.user!.id, id, 1, 0);
  const latest = runs.find((r) => r.status === 'completed') ?? runs[0];
  if (!latest) {
    res.status(404).json(fail('NO_RUNS', 'No runs yet'));
    return;
  }
  await sendCsvForRun(res, id, latest.id, req.user!.id, job.name);
});

jobsRouter.get('/:id/export/csv/:runId', async (req, res) => {
  const parsed = z
    .object({ id: z.string().uuid(), runId: z.string().uuid() })
    .safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json(fail('VALIDATION_ERROR', 'Invalid params'));
    return;
  }
  const { id, runId } = parsed.data;
  const job = await findJob(req.user!.id, id);
  if (!job) {
    res.status(404).json(fail('NOT_FOUND', 'Job not found'));
    return;
  }
  await sendCsvForRun(res, id, runId, req.user!.id, job.name);
});

jobsRouter.post('/:id/export/sheets', sheetsPushLimiter, validate(idParam, 'params'), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParam>;
  const job = await findJob(req.user!.id, id);
  if (!job) {
    res.status(404).json(fail('NOT_FOUND', 'Job not found'));
    return;
  }
  if (!job.google_sheet_id) {
    res.status(400).json(fail('NO_SHEET_LINKED', 'This job has no linked Google Sheet'));
    return;
  }
  const conn = await findConnection(req.user!.id);
  if (!conn) {
    res.status(400).json(fail('NOT_CONNECTED', 'Google is not connected'));
    return;
  }
  const runs = await listRunsForJob(req.user!.id, id, 1, 0);
  const latest = runs.find((r) => r.status === 'completed') ?? runs[0];
  if (!latest) {
    res.status(404).json(fail('NO_RUNS', 'No runs yet'));
    return;
  }
  const data = await listDataForRun(req.user!.id, latest.id);
  if (data.length === 0) {
    res.status(200).json(ok({ appended: 0, runId: latest.id }));
    return;
  }
  try {
    const result = await pushRows({
      userId: req.user!.id,
      sheetId: job.google_sheet_id,
      tabName: job.sheet_tab_name,
      rows: data.map((d) => ({ source_url: d.source_url, extracted_at: d.created_at, ...d.data })),
    });
    res.status(200).json(ok({ appended: result.appended, runId: latest.id }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sheets push failed';
    res.status(502).json(fail('SHEETS_PUSH_FAILED', message));
  }
});

jobsRouter.get('/:id/runs', validate(idParam, 'params'), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParam>;
  const job = await findJob(req.user!.id, id);
  if (!job) {
    res.status(404).json(fail('NOT_FOUND', 'Job not found'));
    return;
  }
  const runs = await listRunsForJob(req.user!.id, id);
  res.status(200).json(ok({ runs }));
});
