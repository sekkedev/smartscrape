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

type SettingsResponse = { settings: Record<string, string> };

export function settingsCommand(getFlags: () => GlobalFlags): Command {
  const settings = new Command('settings').description(
    'Read and write the per-user free-form settings bag',
  );

  settings
    .command('show')
    .description('Print all settings as a table or JSON')
    .action(async () => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        requireToken(client);
        const data = await client.request<SettingsResponse>('/api/settings');
        if (flags.json) emitJson(data.settings, flags);
        else
          emitText(
            renderTable({
              head: ['Key', 'Value'],
              rows: Object.entries(data.settings).map(([k, v]) => [k, v]),
            }),
            flags,
          );
      });
    });

  settings
    .command('set <pairs...>')
    .description("Set one or more settings — each pair is 'key=value'")
    .action(async (pairs: string[]) => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const patch: Record<string, string> = {};
        for (const p of pairs) {
          const idx = p.indexOf('=');
          if (idx === -1)
            throw new CliError(`Bad pair '${p}' — use key=value`, EXIT.VALIDATION, 'BAD_PAIR');
          patch[p.slice(0, idx)] = p.slice(idx + 1);
        }
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        requireToken(client);
        const data = await client.request<SettingsResponse>('/api/settings', {
          method: 'PATCH',
          body: patch,
        });
        if (flags.json) emitJson(data.settings, flags);
        else emitText(`Updated ${Object.keys(patch).length} setting(s)`, flags);
      });
    });

  return settings;
}
