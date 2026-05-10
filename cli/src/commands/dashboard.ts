import { Command } from 'commander';
import { createClient, requireToken } from '../api.js';
import { emitJson, emitText, runCommand, type GlobalFlags } from '../output.js';
import type { DashboardStats } from '../types.js';

export function dashboardCommand(getFlags: () => GlobalFlags): Command {
  const dash = new Command('dashboard').description('Snapshot of activity across all jobs');

  dash
    .command('stats')
    .description('Active jobs, runs today, items tracked, changes this week')
    .action(async () => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        requireToken(client);
        const data = await client.request<DashboardStats>('/api/dashboard/stats');
        if (flags.json) emitJson(data, flags);
        else
          emitText(
            [
              `Active jobs:        ${data.active_jobs}`,
              `Runs today:         ${data.runs_today}`,
              `Items tracked:      ${data.items_tracked}`,
              `Changes this week:  ${data.changes_this_week}`,
            ].join('\n'),
            flags,
          );
      });
    });

  return dash;
}
