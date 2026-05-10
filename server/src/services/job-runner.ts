import { getPool } from '../config/database.js';
import { decrypt } from '../config/encryption.js';
import { findForUser as findApiKey, PROVIDERS } from '../db/apiKeys.js';
import type { JobRow } from '../db/jobs.js';
import { countRunsLast24h, createRun, insertExtractedData, updateRun } from '../db/runs.js';
import { extract, hashItem } from './ai-extractor.js';
import { scrape } from './scraper.js';
import { diffRun } from './change-detector.js';
import { dispatch, evaluateRules } from './notification-service.js';
import { pushRows } from './google-sheets.js';
import { findConnection } from '../db/googleConnections.js';
import { findUserById } from '../db/users.js';
import { classifyError, type ErrorType } from '../lib/error-classifier.js';
import { maybeAutoPause } from './auto-pause.js';

export type RunSummary = {
  runId: string;
  jobId: string;
  status: 'completed' | 'failed';
  itemsExtracted: number;
  tokensUsed: number;
  error?: string;
  errorType?: ErrorType;
};

/**
 * Finalize a failed run with a classified error_type, then check whether the
 * job has hit the consecutive-failure threshold and auto-pause if so. Wraps
 * the existing per-failure-site boilerplate so every exit path classifies
 * and considers auto-pause uniformly.
 */
async function failAndMaybePause(args: {
  runId: string;
  jobId: string;
  userId: string;
  message: string;
  partial?: { urlsScraped?: number; itemsExtracted?: number; tokensUsed?: number };
}): Promise<RunSummary> {
  const errorType = classifyError(args.message);
  await updateRun(args.runId, {
    status: 'failed',
    error_message: args.message,
    error_type: errorType,
    urls_scraped: args.partial?.urlsScraped,
    items_extracted: args.partial?.itemsExtracted,
    tokens_used: args.partial?.tokensUsed,
    completed_at: new Date(),
  });
  // Fire-and-forget the auto-pause check — its own failures are logged and
  // shouldn't keep the run from returning to the worker.
  void maybeAutoPause({
    jobId: args.jobId,
    userId: args.userId,
    runId: args.runId,
    errorType,
    errorMessage: args.message,
  }).catch((err) => {
    console.error('[runner] auto-pause check failed', err);
  });
  return {
    runId: args.runId,
    jobId: args.jobId,
    status: 'failed',
    itemsExtracted: args.partial?.itemsExtracted ?? 0,
    tokensUsed: args.partial?.tokensUsed ?? 0,
    error: args.message,
    errorType,
  };
}

/**
 * Execute a full run for a job:
 *   - create or reuse a scrape_runs row
 *   - for each URL: scrape \u2192 extract \u2192 hash \u2192 insert extracted_data
 *   - update the run row with final status + counters
 */
export const DAILY_RUN_QUOTA = 100;

export async function runJob(job: JobRow, existingRunId?: string): Promise<RunSummary> {
  const run = existingRunId ? { id: existingRunId, job_id: job.id } : await createRun(job.id);

  // Daily run quota: cap total runs per user per rolling 24h to prevent runaway
  // schedules. Manual triggers also pre-check at the route, but enforcing here
  // covers scheduled runs and races between simultaneous triggers.
  // We subtract 1 because the row above is already counted.
  const recent = await countRunsLast24h(job.user_id);
  if (recent - 1 >= DAILY_RUN_QUOTA) {
    return failAndMaybePause({
      runId: run.id,
      jobId: job.id,
      userId: job.user_id,
      message: `Daily run quota reached (${DAILY_RUN_QUOTA}/24h). Run skipped.`,
    });
  }

  const provider = job.ai_provider;
  const keyRow = await findApiKey(job.user_id, provider);
  if (!keyRow) {
    return failAndMaybePause({
      runId: run.id,
      jobId: job.id,
      userId: job.user_id,
      message: `No ${provider} API key configured`,
    });
  }
  let apiKey: string;
  try {
    apiKey = decrypt(keyRow.api_key_encrypted);
  } catch {
    return failAndMaybePause({
      runId: run.id,
      jobId: job.id,
      userId: job.user_id,
      message: 'Stored provider key could not be decrypted',
    });
  }

  // Build the leak-guard lists once per run. Split by type so the API-key
  // length floor doesn't disable email detection for short addresses.
  const apiKeyGuards: string[] = [];
  const emailGuards: string[] = [];
  const user = await findUserById(job.user_id);
  if (user?.email) emailGuards.push(user.email);
  for (const p of PROVIDERS) {
    const row = await findApiKey(job.user_id, p);
    if (!row) continue;
    try {
      apiKeyGuards.push(decrypt(row.api_key_encrypted));
    } catch {
      // ignore — un-decryptable keys can't leak
    }
  }

  await updateRun(run.id, { status: 'scraping' });

  let urlsScraped = 0;
  let itemsExtracted = 0;
  let tokensUsed = 0;
  const allBatches: { source_url: string; data: Record<string, unknown>; data_hash: string }[] = [];

  // Pacing between successive URLs in the same job. When pacing_max_ms is
  // unset we leave it to the per-host throttle in the scraper. When both are
  // set, sleep a uniform-random ms in [min, max] before each URL after the
  // first.
  const pacingMin = job.pacing_min_ms ?? null;
  const pacingMax = job.pacing_max_ms ?? null;

  try {
    let urlIndex = 0;
    for (const url of job.urls) {
      if (urlIndex > 0 && pacingMin !== null && pacingMax !== null) {
        const delay = Math.floor(pacingMin + Math.random() * (pacingMax - pacingMin + 1));
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      }
      urlIndex += 1;
      const page = await scrape(url, job.scrape_method, {
        respectRobotsTxt: job.respect_robots_txt,
        stealth: job.stealth_mode,
        stealthSeed: job.id,
        proxyUrl: job.proxy_url,
      });
      urlsScraped += 1;

      await updateRun(run.id, { status: 'extracting', urls_scraped: urlsScraped });

      const result = await extract({
        provider,
        apiKey,
        model: job.ai_model,
        cleanedHtml: page.cleaned,
        extractionPrompt: job.extraction_prompt,
        extractionSchema: job.extraction_schema ?? undefined,
        apiKeyGuards,
        emailGuards,
      });

      if (!result.ok) {
        throw new Error(`Extraction failed for ${url}: ${result.error}`);
      }
      tokensUsed += (result.usage.promptTokens ?? 0) + (result.usage.completionTokens ?? 0);
      for (const item of result.items) {
        allBatches.push({
          source_url: page.finalUrl,
          data: item,
          data_hash: hashItem(item),
        });
      }
      itemsExtracted += result.items.length;
    }

    await insertExtractedData(run.id, job.id, allBatches);

    // Optional: export to Google Sheets if the job has one linked and the user is connected.
    let exportError: string | null = null;
    if (job.google_sheet_id && allBatches.length > 0) {
      await updateRun(run.id, { status: 'exporting' });
      const conn = await findConnection(job.user_id);
      if (!conn) {
        exportError = 'Google Sheets export skipped: user has not connected Google.';
      } else {
        try {
          await pushRows({
            userId: job.user_id,
            sheetId: job.google_sheet_id,
            tabName: job.sheet_tab_name,
            rows: allBatches.map((b) => b.data),
          });
        } catch (err) {
          exportError = err instanceof Error ? err.message : String(err);
          console.error('[runner] sheets export failed', exportError);
        }
      }
    }

    await updateRun(run.id, {
      status: 'completed',
      urls_scraped: urlsScraped,
      items_extracted: itemsExtracted,
      tokens_used: tokensUsed,
      export_error: exportError,
      completed_at: new Date(),
    });
    await getPool().query(`UPDATE scrape_jobs SET last_run_at = now() WHERE id = $1`, [job.id]);

    // Evaluate notification rules against the diff vs the previous run.
    try {
      const diff = await diffRun(job.user_id, run.id);
      if (diff) {
        const notifs = evaluateRules(job, diff);
        await dispatch(job, run.id, notifs);
      }
    } catch (err) {
      // Notification failures should not fail the run.
      console.error('[runner] notification dispatch error', err);
    }

    return {
      runId: run.id,
      jobId: job.id,
      status: 'completed',
      itemsExtracted,
      tokensUsed,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failAndMaybePause({
      runId: run.id,
      jobId: job.id,
      userId: job.user_id,
      message,
      partial: { urlsScraped, itemsExtracted, tokensUsed },
    });
  }
}
