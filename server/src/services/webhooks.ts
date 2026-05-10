import { createHmac } from 'node:crypto';
import { decrypt } from '../config/encryption.js';
import type { JobRow } from '../db/jobs.js';
import { listDataForRun, updateRun, type RunRow } from '../db/runs.js';
import { diffRun, type DiffResult } from './change-detector.js';
import { assertSafeUrl } from '../lib/ssrf.js';

/**
 * Shape of the body POSTed to a job's webhook_url after each terminal run.
 * Stable contract — clients verify against the X-Webhook-Signature header.
 */
export type WebhookPayload = {
  event: 'run.completed' | 'run.failed' | 'webhook.test';
  job_id: string;
  job_name: string;
  run_id: string;
  status: RunRow['status'];
  items_count: number;
  urls_scraped: number;
  tokens_used: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  changes: {
    added: number;
    removed: number;
    changed: number;
  } | null;
  items: Record<string, unknown>[];
};

export type DeliveryResult = {
  ok: boolean;
  attempts: number;
  status?: number;
  error?: string;
};

export type DeliverArgs = {
  url: string;
  secretEncrypted: string | null;
  payload: WebhookPayload;
  /** Override transport for tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Override sleep for tests so backoff doesn't make the suite slow. */
  sleepMs?: (ms: number) => Promise<void>;
};

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1_000;
const REQUEST_TIMEOUT_MS = 10_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function signPayload(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/**
 * Deliver a payload with at most 3 attempts and exponential backoff (1s → 4s).
 * SSRF is asserted up front; once the URL is approved we trust the body of the
 * retries to hit the same destination.
 */
export async function deliver(args: DeliverArgs): Promise<DeliveryResult> {
  const safety = await assertSafeUrl(args.url);
  if (!safety.ok) {
    return { ok: false, attempts: 0, error: `Unsafe webhook URL: ${safety.reason}` };
  }
  const body = JSON.stringify(args.payload);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    'user-agent': 'SmartScrape-Webhook/1.0',
  };
  if (args.secretEncrypted) {
    let secret: string;
    try {
      secret = decrypt(args.secretEncrypted);
    } catch {
      return {
        ok: false,
        attempts: 0,
        error: 'Webhook secret could not be decrypted (re-set it via the API)',
      };
    }
    headers['x-webhook-signature'] = signPayload(secret, body);
    headers['x-webhook-timestamp'] = new Date().toISOString();
  }

  const sleep = args.sleepMs ?? defaultSleep;
  const fetcher = args.fetchImpl ?? fetch;
  let lastErr = '';
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetcher(args.url, {
        method: 'POST',
        headers,
        body,
        signal: ac.signal,
      });
      lastStatus = res.status;
      // 2xx is delivered. Other status codes are retryable.
      if (res.ok) {
        return { ok: true, attempts: attempt, status: res.status };
      }
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }
    if (attempt < MAX_ATTEMPTS) {
      // 1s, then 4s — bounded by REQUEST_TIMEOUT_MS so a stuck receiver can't
      // drag a run worker past its quota.
      await sleep(BASE_DELAY_MS * Math.pow(4, attempt - 1));
    }
  }
  return { ok: false, attempts: MAX_ATTEMPTS, status: lastStatus, error: lastErr };
}

/**
 * Build the payload for a finished run, deliver it, and persist the delivery
 * outcome on the run row. The caller (job-queue worker) invokes this after
 * `runJob` returns so we don't block the run finalisation on receiver latency.
 */
export async function deliverForRun(args: {
  job: JobRow;
  userId: string;
  run: Pick<RunRow, 'id' | 'status' | 'items_extracted' | 'urls_scraped' | 'tokens_used'> & {
    error_message: string | null;
    started_at: Date | string;
    completed_at: Date | string | null;
  };
  fetchImpl?: typeof fetch;
  sleepMs?: (ms: number) => Promise<void>;
}): Promise<DeliveryResult> {
  if (!args.job.webhook_url) {
    return { ok: false, attempts: 0, error: 'no_webhook_url' };
  }

  // Diff and item list are best-effort: failed runs may not have data, and
  // diffRun returns null if the run is missing. Fall back to empty values.
  let diff: DiffResult | null = null;
  try {
    diff = await diffRun(args.userId, args.run.id);
  } catch {
    diff = null;
  }
  let items: Record<string, unknown>[] = [];
  if (args.run.status === 'completed') {
    try {
      const rows = await listDataForRun(args.userId, args.run.id);
      items = rows.map((r) => r.data);
    } catch {
      items = [];
    }
  }

  const startedAt =
    args.run.started_at instanceof Date ? args.run.started_at.toISOString() : args.run.started_at;
  const completedAt = args.run.completed_at
    ? args.run.completed_at instanceof Date
      ? args.run.completed_at.toISOString()
      : args.run.completed_at
    : null;

  const payload: WebhookPayload = {
    event: args.run.status === 'completed' ? 'run.completed' : 'run.failed',
    job_id: args.job.id,
    job_name: args.job.name,
    run_id: args.run.id,
    status: args.run.status,
    items_count: args.run.items_extracted,
    urls_scraped: args.run.urls_scraped,
    tokens_used: args.run.tokens_used,
    error_message: args.run.error_message,
    started_at: startedAt,
    completed_at: completedAt,
    changes: diff
      ? { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length }
      : null,
    items,
  };

  const result = await deliver({
    url: args.job.webhook_url,
    secretEncrypted: args.job.webhook_secret_encrypted,
    payload,
    fetchImpl: args.fetchImpl,
    sleepMs: args.sleepMs,
  });

  await updateRun(args.run.id, {
    webhook_status: result.ok ? 'success' : 'failed',
    webhook_attempts: result.attempts,
    webhook_last_error: result.ok ? null : (result.error ?? `HTTP ${result.status ?? '?'}`),
    webhook_delivered_at: result.ok ? new Date() : null,
  });

  return result;
}

/**
 * Build a fixed, recognisable payload for the "Send test payload" flow. Used
 * by both the API test endpoint and the CLI `jobs webhook test` command.
 */
export function buildTestPayload(job: JobRow): WebhookPayload {
  return {
    event: 'webhook.test',
    job_id: job.id,
    job_name: job.name,
    run_id: '00000000-0000-0000-0000-000000000000',
    status: 'completed',
    items_count: 0,
    urls_scraped: 0,
    tokens_used: 0,
    error_message: null,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    changes: { added: 0, removed: 0, changed: 0 },
    items: [],
  };
}
