import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { createClient, requireToken } from '../api.js';
import {
  CliError,
  EXIT,
  ageString,
  emitJson,
  emitText,
  renderTable,
  runCommand,
  shortId,
  type GlobalFlags,
} from '../output.js';
import type {
  JobDTO,
  JobListItem,
  NotificationRule,
  NotifyChannel,
  Provider,
  RunDTO,
  ScrapeMethod,
} from '../types.js';

type CreateInput = {
  name: string;
  urls: string[];
  extraction_prompt: string;
  extraction_schema?: Record<string, 'string' | 'number' | 'boolean' | 'array' | 'object'> | null;
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
  setup_method?: 'manual' | 'ai';
  respect_robots_txt?: boolean;
};

function readJsonFromOpt(value: string | undefined, label: string): unknown {
  if (value === undefined) return undefined;
  let raw = value;
  if (raw.startsWith('@')) {
    const path = raw.slice(1);
    try {
      raw = readFileSync(path, 'utf8');
    } catch (err) {
      throw new CliError(
        `Could not read ${label} file '${path}': ${err instanceof Error ? err.message : err}`,
        EXIT.VALIDATION,
        'BAD_INPUT',
      );
    }
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new CliError(
      `Invalid JSON for ${label}: ${err instanceof Error ? err.message : err}`,
      EXIT.VALIDATION,
      'BAD_INPUT',
    );
  }
}

function parseSchedule(input: string | undefined): string | null | undefined {
  if (input === undefined) return undefined;
  if (input === 'none' || input === '') return null;
  if (input === 'hourly') return '0 * * * *';
  if (input === 'daily') return '0 9 * * *';
  if (input === 'weekly') return '0 9 * * 1';
  return input;
}

function buildCreateBody(
  opts: Record<string, string | string[] | boolean | undefined>,
): CreateInput {
  const urls = (opts.url as string[] | undefined) ?? [];
  if (urls.length === 0) {
    throw new CliError('At least one --url is required', EXIT.VALIDATION, 'MISSING_URL');
  }
  const body: CreateInput = {
    name: String(opts.name),
    urls,
    extraction_prompt: String(opts.prompt ?? ''),
  };
  if (opts.schema !== undefined) {
    body.extraction_schema = readJsonFromOpt(opts.schema as string, '--schema') as
      | CreateInput['extraction_schema']
      | undefined;
  }
  if (opts.method !== undefined) body.scrape_method = opts.method as ScrapeMethod;
  const sched = parseSchedule(opts.schedule as string | undefined);
  if (sched !== undefined) body.schedule = sched;
  if (opts.disabled === true) body.enabled = false;
  if (opts.rules !== undefined) {
    body.notification_rules = readJsonFromOpt(opts.rules as string, '--rules') as
      | NotificationRule[]
      | undefined;
  }
  if (opts.channels !== undefined) {
    body.notify_channels = (opts.channels as string)
      .split(',')
      .map((s) => s.trim()) as NotifyChannel[];
  }
  if (opts.comparisonKey !== undefined) body.comparison_key = String(opts.comparisonKey);
  if (opts.provider !== undefined) body.ai_provider = opts.provider as Provider;
  if (opts.model !== undefined) body.ai_model = String(opts.model);
  if (opts.sheetId !== undefined) body.google_sheet_id = String(opts.sheetId);
  if (opts.sheetTab !== undefined) body.sheet_tab_name = String(opts.sheetTab);
  if (opts.respectRobots !== undefined) body.respect_robots_txt = Boolean(opts.respectRobots);
  return body;
}

function statusBadge(job: JobListItem): string {
  if (!job.enabled) return 'paused';
  if (job.last_run_status === 'failed') return 'failed';
  if (job.last_run_status) return `active (${job.last_run_status})`;
  return 'active';
}

export function jobsCommand(getFlags: () => GlobalFlags): Command {
  const jobs = new Command('jobs').description('Manage scrape jobs');

  jobs
    .command('list')
    .description('List jobs for the authenticated user')
    .option('--filter <filter>', 'all|active|paused|failed', 'all')
    .option('--limit <n>', 'Max rows to return', (v) => parseInt(v, 10), 50)
    .option('--offset <n>', 'Skip the first N rows', (v) => parseInt(v, 10), 0)
    .action(async (opts: { filter: string; limit: number; offset: number }) => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        requireToken(client);
        const data = await client.request<{ items: JobListItem[]; total: number }>('/api/jobs', {
          query: { filter: opts.filter, limit: opts.limit, offset: opts.offset },
        });
        if (flags.json) {
          emitJson(data, flags);
          return;
        }
        const rows = data.items.map((j) => [
          shortId(j.id),
          j.name,
          statusBadge(j),
          j.schedule ?? 'manual',
          ageString(j.last_run_at),
          j.last_run_items ?? '—',
        ]);
        emitText(
          renderTable({
            head: ['ID', 'Name', 'Status', 'Schedule', 'Last run', 'Items'],
            rows,
          }),
          flags,
        );
        emitText(`Total: ${data.total}`, flags);
      });
    });

  jobs
    .command('show <id>')
    .description('Show a single job')
    .action(async (id: string) => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        requireToken(client);
        const data = await client.request<{ job: JobDTO }>(`/api/jobs/${id}`);
        if (flags.json) {
          emitJson(data.job, flags);
          return;
        }
        const j = data.job;
        emitText(
          [
            `ID:           ${j.id}`,
            `Name:         ${j.name}`,
            `Enabled:      ${j.enabled}`,
            `Schedule:     ${j.schedule ?? 'manual'}`,
            `Method:       ${j.scrape_method}`,
            `URLs:`,
            ...j.urls.map((u) => `  - ${u}`),
            `Prompt:       ${j.extraction_prompt}`,
            `AI:           ${j.ai_provider} / ${j.ai_model}`,
            `Compare key:  ${j.comparison_key ?? '(data hash)'}`,
            `Channels:     ${j.notify_channels.join(', ') || '(none)'}`,
            `Rules:        ${j.notification_rules.length}`,
            `Last run:     ${j.last_run_at ?? 'never'}`,
            `Created:      ${j.created_at}`,
          ].join('\n'),
          flags,
        );
      });
    });

  const create = jobs
    .command('create')
    .description('Create a new job (manual setup — use the webapp wizard for AI-assisted setup)')
    .requiredOption('--name <name>', 'Display name')
    .requiredOption('--url <url...>', 'Page to scrape (repeatable for multiple URLs)')
    .requiredOption('--prompt <text>', 'Extraction prompt (what to pull off the page)')
    .option('--schema <json|@file>', 'Optional extraction schema as JSON or @path')
    .option('--method <auto|cheerio|playwright>', 'Scrape method', 'auto')
    .option('--schedule <cron|hourly|daily|weekly|none>', 'Cron expression or preset')
    .option('--disabled', 'Create the job in a paused state')
    .option('--rules <json|@file>', 'Notification rules array as JSON or @path')
    .option('--channels <list>', 'Comma-separated channels: email,telegram')
    .option('--comparison-key <field>', 'Field used to match rows across runs')
    .option('--provider <openai|anthropic|openrouter>', 'AI provider')
    .option('--model <id>', 'AI model id, e.g. openai/gpt-4o-mini')
    .option('--sheet-id <id>', 'Linked Google Sheet ID')
    .option('--sheet-tab <name>', 'Tab name within the sheet')
    .option('--no-respect-robots', 'Ignore robots.txt for this job');
  create.action(async (opts: Record<string, string | string[] | boolean | undefined>) => {
    const flags = getFlags();
    await runCommand(flags, async () => {
      const body = buildCreateBody(opts);
      const client = createClient({
        url: flags.serverUrl,
        token: flags.token,
        apiKey: flags.apiKey,
      });
      requireToken(client);
      const data = await client.request<{ job: JobDTO }>('/api/jobs', {
        method: 'POST',
        body,
      });
      if (flags.json) emitJson(data.job, flags);
      else emitText(`Created job ${data.job.id} (${data.job.name})`, flags);
    });
  });

  jobs
    .command('edit <id>')
    .description('Update fields on an existing job (only flags you pass are sent)')
    .option('--name <name>', 'Display name')
    .option('--prompt <text>', 'Extraction prompt')
    .option('--schema <json|@file>', 'Extraction schema as JSON or @path')
    .option('--method <auto|cheerio|playwright>', 'Scrape method')
    .option('--schedule <cron|hourly|daily|weekly|none>', 'Cron expression or preset')
    .option('--rules <json|@file>', 'Notification rules array')
    .option('--channels <list>', 'Comma-separated channels: email,telegram')
    .option('--comparison-key <field>', 'Field used to match rows across runs')
    .option('--provider <openai|anthropic|openrouter>', 'AI provider')
    .option('--model <id>', 'AI model id')
    .option('--sheet-id <id>', 'Linked Google Sheet ID')
    .option('--sheet-tab <name>', 'Tab name within the sheet')
    .action(async (id: string, opts: Record<string, string | boolean | undefined>) => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const patch: Partial<CreateInput> = {};
        if (opts.name !== undefined) patch.name = String(opts.name);
        if (opts.prompt !== undefined) patch.extraction_prompt = String(opts.prompt);
        if (opts.schema !== undefined) {
          patch.extraction_schema = readJsonFromOpt(opts.schema as string, '--schema') as
            | CreateInput['extraction_schema']
            | undefined;
        }
        if (opts.method !== undefined) patch.scrape_method = opts.method as ScrapeMethod;
        const sched = parseSchedule(opts.schedule as string | undefined);
        if (sched !== undefined) patch.schedule = sched;
        if (opts.rules !== undefined) {
          patch.notification_rules = readJsonFromOpt(opts.rules as string, '--rules') as
            | NotificationRule[]
            | undefined;
        }
        if (opts.channels !== undefined) {
          patch.notify_channels = String(opts.channels)
            .split(',')
            .map((s) => s.trim()) as NotifyChannel[];
        }
        if (opts.comparisonKey !== undefined) patch.comparison_key = String(opts.comparisonKey);
        if (opts.provider !== undefined) patch.ai_provider = opts.provider as Provider;
        if (opts.model !== undefined) patch.ai_model = String(opts.model);
        if (opts.sheetId !== undefined) patch.google_sheet_id = String(opts.sheetId);
        if (opts.sheetTab !== undefined) patch.sheet_tab_name = String(opts.sheetTab);

        if (Object.keys(patch).length === 0) {
          throw new CliError(
            'Pass at least one field to update (e.g. --name, --schedule, --prompt).',
            EXIT.VALIDATION,
            'NO_PATCH',
          );
        }
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        requireToken(client);
        const data = await client.request<{ job: JobDTO }>(`/api/jobs/${id}`, {
          method: 'PATCH',
          body: patch,
        });
        if (flags.json) emitJson(data.job, flags);
        else emitText(`Updated job ${data.job.id}`, flags);
      });
    });

  jobs
    .command('toggle <id>')
    .description('Flip the enabled flag — paused jobs become active and vice versa')
    .action(async (id: string) => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        requireToken(client);
        const data = await client.request<{ job: JobDTO }>(`/api/jobs/${id}/toggle`, {
          method: 'PATCH',
        });
        if (flags.json) emitJson(data.job, flags);
        else emitText(`Job ${data.job.id} → ${data.job.enabled ? 'active' : 'paused'}`, flags);
      });
    });

  jobs
    .command('delete <id>')
    .description('Permanently delete a job and its scheduled runs')
    .option('--confirm', 'Required: confirm the deletion (no interactive prompt)')
    .action(async (id: string, opts: { confirm?: boolean }) => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        if (!opts.confirm) {
          throw new CliError(
            'Refusing to delete without --confirm flag',
            EXIT.VALIDATION,
            'CONFIRM_REQUIRED',
          );
        }
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        requireToken(client);
        const data = await client.request<{ removed: boolean }>(`/api/jobs/${id}`, {
          method: 'DELETE',
        });
        if (flags.json) emitJson({ id, removed: data.removed }, flags);
        else emitText(`Deleted job ${id}`, flags);
      });
    });

  jobs
    .command('run <id>')
    .description('Trigger an immediate run; queues the job and returns the run row')
    .option('--wait', 'Poll until the run reaches a terminal state, then exit')
    .option('--timeout <s>', 'Max seconds to wait when --wait is set', (v) => parseInt(v, 10), 300)
    .action(async (id: string, opts: { wait?: boolean; timeout: number }) => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        requireToken(client);
        const triggered = await client.request<{ run: RunDTO }>(`/api/jobs/${id}/run`, {
          method: 'POST',
        });
        let final = triggered.run;
        if (opts.wait) {
          const deadline = Date.now() + opts.timeout * 1000;
          // Poll the run endpoint at a modest interval — server-side rate
          // limits don't kick in for the per-run reads, but we don't need to
          // hammer either.
          while (Date.now() < deadline) {
            const cur = await client.request<{ run: RunDTO }>(`/api/runs/${final.id}`);
            final = cur.run;
            if (final.status === 'completed' || final.status === 'failed') break;
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
        if (flags.json) emitJson(final, flags);
        else emitText(`Run ${final.id} → ${final.status} (items: ${final.items_extracted})`, flags);
      });
    });

  return jobs;
}
