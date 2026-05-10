#!/usr/bin/env node
import { Command } from 'commander';
import { authCommand } from './commands/auth.js';
import { dashboardCommand } from './commands/dashboard.js';
import { exportCommand } from './commands/export.js';
import { jobsCommand } from './commands/jobs.js';
import { notificationsCommand } from './commands/notifications.js';
import { providersCommand } from './commands/providers.js';
import { resultsCommand } from './commands/results.js';
import { runsCommand } from './commands/runs.js';
import { settingsCommand } from './commands/settings.js';
import type { GlobalFlags } from './output.js';

const program = new Command();
program
  .name('smartscrape')
  .description('SmartScrape CLI — drive the REST API from cron, scripts, and agents')
  .version('0.9.0')
  .option('--json', 'Emit JSON instead of formatted tables')
  .option('--quiet', 'Suppress non-error output (data still goes to stdout)')
  .option('--server-url <url>', 'Override the SmartScrape server URL (also: SMARTSCRAPE_URL env)')
  .option('--token <token>', 'Override the JWT access token (also: SMARTSCRAPE_TOKEN env)')
  .option(
    '--api-key <key>',
    'Use a personal access token instead of a JWT (also: SMARTSCRAPE_API_KEY env)',
  );

// Commands read flags via a getter so children resolve them after parsing.
const getFlags = (): GlobalFlags => program.opts<GlobalFlags>();

program.addCommand(authCommand(getFlags));
program.addCommand(jobsCommand(getFlags));
program.addCommand(runsCommand(getFlags));
program.addCommand(resultsCommand(getFlags));
program.addCommand(exportCommand(getFlags));
program.addCommand(providersCommand(getFlags));
program.addCommand(settingsCommand(getFlags));
program.addCommand(notificationsCommand(getFlags));
program.addCommand(dashboardCommand(getFlags));

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
