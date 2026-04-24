import { Router } from 'express';
import { z } from 'zod';
import { assertSafeUrl } from '../lib/ssrf.js';
import { fail, ok } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createJob,
  deleteJob,
  findJob,
  listJobs,
  toDTO as toJobDTO,
  toggleJob,
  updateJob,
} from '../db/jobs.js';
import { listRunsForJob } from '../db/runs.js';

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

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
  schedule: z.string().nullable().optional(),
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
  res.status(200).json(ok({ job: toJobDTO(row) }));
});

jobsRouter.patch('/:id/toggle', validate(idParam, 'params'), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParam>;
  const row = await toggleJob(req.user!.id, id);
  if (!row) {
    res.status(404).json(fail('NOT_FOUND', 'Job not found'));
    return;
  }
  res.status(200).json(ok({ job: toJobDTO(row) }));
});

jobsRouter.delete('/:id', validate(idParam, 'params'), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParam>;
  const removed = await deleteJob(req.user!.id, id);
  if (!removed) {
    res.status(404).json(fail('NOT_FOUND', 'Job not found'));
    return;
  }
  res.status(200).json(ok({ removed: true }));
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
