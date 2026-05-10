import { Command } from 'commander';
import { createClient, requireToken } from '../api.js';
import { CliError, EXIT, emitJson, emitText, runCommand, type GlobalFlags } from '../output.js';

export function notificationsCommand(getFlags: () => GlobalFlags): Command {
  const notif = new Command('notifications').description('Test and inspect notification channels');

  notif
    .command('test <channel>')
    .description("Send a test notification on 'email' or 'telegram'")
    .action(async (channel: string) => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        if (channel !== 'email' && channel !== 'telegram') {
          throw new CliError(
            "Channel must be 'email' or 'telegram'",
            EXIT.VALIDATION,
            'BAD_CHANNEL',
          );
        }
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        requireToken(client);
        const data = await client.request<unknown>(`/api/notifications/test/${channel}`, {
          method: 'POST',
        });
        if (flags.json) emitJson(data, flags);
        else emitText(JSON.stringify(data, null, 2), flags);
      });
    });

  return notif;
}
