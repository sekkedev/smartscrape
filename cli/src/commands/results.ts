import { Command } from 'commander';
import { createClient, requireToken } from '../api.js';
import {
  CliError,
  EXIT,
  emitJson,
  emitText,
  renderTable,
  runCommand,
  type GlobalFlags,
} from '../output.js';
import type { ExtractedDataDTO, RunDTO } from '../types.js';

/**
 * `smartscrape results <jobId>` — convenience wrapper that resolves the latest
 * completed run for a job (or the run id passed via --run-id) and prints its
 * data. Avoids the two-step "list runs, then read data" dance.
 */
export function resultsCommand(getFlags: () => GlobalFlags): Command {
  return new Command('results')
    .description('Show extracted data from a job — defaults to its latest completed run')
    .argument('<jobId>')
    .option('--run-id <id>', 'Read a specific run instead of the latest')
    .option('--format <fmt>', 'json|table (default: table; --json overrides)', 'table')
    .action(async (jobId: string, opts: { runId?: string; format: string }) => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        requireToken(client);
        let runId = opts.runId;
        if (!runId) {
          const list = await client.request<{ runs: RunDTO[] }>(`/api/jobs/${jobId}/runs`);
          const latestCompleted = list.runs.find((r) => r.status === 'completed') ?? list.runs[0];
          if (!latestCompleted) {
            throw new CliError('No runs yet for this job', EXIT.NOT_FOUND, 'NO_RUNS');
          }
          runId = latestCompleted.id;
        }
        const data = await client.request<{ data: ExtractedDataDTO[] }>(`/api/runs/${runId}/data`);
        if (flags.json || opts.format === 'json') {
          emitJson(data.data, flags);
          return;
        }
        if (data.data.length === 0) {
          emitText('(no rows)', flags);
          return;
        }
        const fields = Array.from(new Set(data.data.flatMap((row) => Object.keys(row.data)))).slice(
          0,
          6,
        );
        const rows = data.data.map((row) => [
          row.source_url,
          ...fields.map((f) => {
            const v = row.data[f];
            if (v === null || v === undefined) return '';
            return typeof v === 'object' ? JSON.stringify(v) : String(v);
          }),
        ]);
        emitText(renderTable({ head: ['Source', ...fields], rows }), flags);
      });
    });
}
