import { Command } from 'commander';
import { createClient, requireToken } from '../api.js';
import {
  ageString,
  emitJson,
  emitText,
  renderTable,
  runCommand,
  shortId,
  type GlobalFlags,
} from '../output.js';
import type { DiffResult, ExtractedDataDTO, RunDTO } from '../types.js';

export function runsCommand(getFlags: () => GlobalFlags): Command {
  const runs = new Command('runs').description('Inspect runs and their results');

  runs
    .command('list <jobId>')
    .description('List runs for a job (newest first)')
    .action(async (jobId: string) => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        requireToken(client);
        const data = await client.request<{ runs: RunDTO[] }>(`/api/jobs/${jobId}/runs`);
        if (flags.json) {
          emitJson(data.runs, flags);
          return;
        }
        emitText(
          renderTable({
            head: ['Run', 'Status', 'Items', 'Tokens', 'Started', 'Completed'],
            rows: data.runs.map((r) => [
              shortId(r.id),
              r.status,
              r.items_extracted,
              r.tokens_used,
              ageString(r.started_at),
              r.completed_at ? ageString(r.completed_at) : '—',
            ]),
          }),
          flags,
        );
      });
    });

  runs
    .command('show <id>')
    .description('Show a single run')
    .action(async (id: string) => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        requireToken(client);
        const data = await client.request<{ run: RunDTO }>(`/api/runs/${id}`);
        if (flags.json) {
          emitJson(data.run, flags);
          return;
        }
        const r = data.run;
        emitText(
          [
            `ID:          ${r.id}`,
            `Job:         ${r.job_id}`,
            `Status:      ${r.status}`,
            `URLs:        ${r.urls_scraped}`,
            `Items:       ${r.items_extracted}`,
            `Tokens:      ${r.tokens_used}`,
            `Started:     ${r.started_at}`,
            `Completed:   ${r.completed_at ?? '—'}`,
            r.error_message ? `Error:       ${r.error_message}` : '',
            r.export_error ? `ExportErr:   ${r.export_error}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          flags,
        );
      });
    });

  runs
    .command('data <id>')
    .description('List extracted data rows for a single run')
    .action(async (id: string) => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        requireToken(client);
        const data = await client.request<{ data: ExtractedDataDTO[] }>(`/api/runs/${id}/data`);
        if (flags.json) {
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
        const head = ['Source', ...fields];
        const rows = data.data.map((row) => [
          row.source_url,
          ...fields.map((f) => {
            const v = row.data[f];
            if (v === null || v === undefined) return '';
            return typeof v === 'object' ? JSON.stringify(v) : String(v);
          }),
        ]);
        emitText(renderTable({ head, rows }), flags);
        emitText(`Total rows: ${data.data.length}`, flags);
      });
    });

  runs
    .command('diff <id>')
    .description('Show added/removed/changed rows vs the previous completed run')
    .action(async (id: string) => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        requireToken(client);
        const data = await client.request<{ diff: DiffResult }>(`/api/runs/${id}/diff`);
        if (flags.json) {
          emitJson(data.diff, flags);
          return;
        }
        const d = data.diff;
        emitText(
          [
            `Current:   ${d.current_run.id}  (${d.current_run.started_at})`,
            `Previous:  ${d.previous_run?.id ?? '(none — first run)'}`,
            `Compare:   ${d.comparison_key ?? '(content hash)'}`,
            ``,
            `Added:     ${d.added.length}`,
            `Removed:   ${d.removed.length}`,
            `Changed:   ${d.changed.length}`,
          ].join('\n'),
          flags,
        );
        if (d.changed.length > 0) {
          for (const c of d.changed.slice(0, 10)) {
            emitText(`\n• ${c.key ?? '(no key)'}`, flags);
            for (const fd of c.field_diffs) {
              emitText(
                `    ${fd.field}: ${JSON.stringify(fd.old)} → ${JSON.stringify(fd.new)}`,
                flags,
              );
            }
          }
        }
      });
    });

  return runs;
}
