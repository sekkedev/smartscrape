import { getPool } from '../config/database.js';
import { decrypt } from '../config/encryption.js';
import { findForUser as findApiKey } from '../db/apiKeys.js';
import type { JobRow } from '../db/jobs.js';
import { createRun, insertExtractedData, updateRun } from '../db/runs.js';
import { extract, hashItem } from './ai-extractor.js';
import { scrape } from './scraper.js';
import { diffRun } from './change-detector.js';
import { dispatch, evaluateRules } from './notification-service.js';
import { pushRows } from './google-sheets.js';
import { findConnection } from '../db/googleConnections.js';

export type RunSummary = {
  runId: string;
  jobId: string;
  status: 'completed' | 'failed';
  itemsExtracted: number;
  tokensUsed: number;
  error?: string;
};

/**
 * Execute a full run for a job:
 *   - create or reuse a scrape_runs row
 *   - for each URL: scrape \u2192 extract \u2192 hash \u2192 insert extracted_data
 *   - update the run row with final status + counters
 */
export async function runJob(job: JobRow, existingRunId?: string): Promise<RunSummary> {
  const run = existingRunId
    ? { id: existingRunId, job_id: job.id }
    : await createRun(job.id);

  const provider = job.ai_provider;
  const keyRow = await findApiKey(job.user_id, provider);
  if (!keyRow) {
    const err = `No ${provider} API key configured`;
    await updateRun(run.id, { status: 'failed', error_message: err, completed_at: new Date() });
    return { runId: run.id, jobId: job.id, status: 'failed', itemsExtracted: 0, tokensUsed: 0, error: err };
  }
  let apiKey: string;
  try {
    apiKey = decrypt(keyRow.api_key_encrypted);
  } catch {
    const err = 'Stored provider key could not be decrypted';
    await updateRun(run.id, { status: 'failed', error_message: err, completed_at: new Date() });
    return { runId: run.id, jobId: job.id, status: 'failed', itemsExtracted: 0, tokensUsed: 0, error: err };
  }

  await updateRun(run.id, { status: 'scraping' });

  let urlsScraped = 0;
  let itemsExtracted = 0;
  let tokensUsed = 0;
  const allBatches: { source_url: string; data: Record<string, unknown>; data_hash: string }[] = [];

  try {
    for (const url of job.urls) {
      const page = await scrape(url, job.scrape_method);
      urlsScraped += 1;

      await updateRun(run.id, { status: 'extracting', urls_scraped: urlsScraped });

      const result = await extract({
        provider,
        apiKey,
        model: job.ai_model,
        cleanedHtml: page.cleaned,
        extractionPrompt: job.extraction_prompt,
        extractionSchema: job.extraction_schema ?? undefined,
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
    await updateRun(run.id, {
      status: 'failed',
      urls_scraped: urlsScraped,
      items_extracted: itemsExtracted,
      tokens_used: tokensUsed,
      error_message: message,
      completed_at: new Date(),
    });
    return {
      runId: run.id,
      jobId: job.id,
      status: 'failed',
      itemsExtracted,
      tokensUsed,
      error: message,
    };
  }
}
