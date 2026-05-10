import { Command } from 'commander';
import { createClient, requireToken } from '../api.js';
import { CliError, EXIT, emitJson, emitText, runCommand, type GlobalFlags } from '../output.js';
import type { ExtractedDataDTO, RunDTO } from '../types.js';

/**
 * Export the latest run's data as CSV (server-rendered), JSON (rows), or push
 * to the linked Google Sheet. Mutually exclusive flags — one must be set.
 */
export function exportCommand(getFlags: () => GlobalFlags): Command {
  return new Command('export')
    .description('Export the latest run for a job to CSV, JSON, or the linked Google Sheet')
    .argument('<jobId>')
    .option('--csv', 'Stream the server-rendered CSV to stdout')
    .option('--json', 'Print the extracted-data rows as JSON')
    .option('--sheets', "Push the latest run to the job's linked Google Sheet")
    .option('--run-id <id>', 'Use a specific run instead of the latest completed one')
    .action(
      async (
        jobId: string,
        opts: { csv?: boolean; json?: boolean; sheets?: boolean; runId?: string },
      ) => {
        const flags = getFlags();
        await runCommand(flags, async () => {
          const targets = [opts.csv, opts.json, opts.sheets].filter(Boolean).length;
          if (targets !== 1) {
            throw new CliError(
              'Specify exactly one of --csv, --json, or --sheets',
              EXIT.VALIDATION,
              'BAD_TARGET',
            );
          }
          const client = createClient({
            url: flags.serverUrl,
            token: flags.token,
            apiKey: flags.apiKey,
          });
          requireToken(client);

          if (opts.sheets) {
            const data = await client.request<{ appended: number; runId: string }>(
              `/api/jobs/${jobId}/export/sheets`,
              { method: 'POST' },
            );
            if (flags.json) emitJson(data, flags);
            else emitText(`Appended ${data.appended} row(s) from run ${data.runId}`, flags);
            return;
          }

          // Resolve the run id once for both CSV and JSON paths.
          let runId = opts.runId;
          if (!runId) {
            const list = await client.request<{ runs: RunDTO[] }>(`/api/jobs/${jobId}/runs`);
            const latest = list.runs.find((r) => r.status === 'completed') ?? list.runs[0];
            if (!latest) throw new CliError('No runs yet', EXIT.NOT_FOUND, 'NO_RUNS');
            runId = latest.id;
          }

          if (opts.csv) {
            const path = opts.runId
              ? `/api/jobs/${jobId}/export/csv/${runId}`
              : `/api/jobs/${jobId}/export/csv`;
            const res = await client.requestRaw(path);
            if (!res.ok) {
              throw new CliError(
                `CSV export failed (HTTP ${res.status})`,
                res.status === 404 ? EXIT.NOT_FOUND : EXIT.ERROR,
              );
            }
            const text = await res.text();
            // Always write to stdout — pipe to a file from the shell. --quiet
            // doesn't suppress data output, only status messages.
            process.stdout.write(text);
            return;
          }

          // JSON path — fetch raw rows via /api/runs/:id/data.
          const data = await client.request<{ data: ExtractedDataDTO[] }>(
            `/api/runs/${runId}/data`,
          );
          process.stdout.write(JSON.stringify(data.data, null, 2) + '\n');
        });
      },
    );
}
