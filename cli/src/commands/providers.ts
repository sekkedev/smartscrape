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
import type { Provider, ProviderRow } from '../types.js';

const VALID_PROVIDERS = new Set<Provider>(['openai', 'anthropic', 'openrouter']);

function asProvider(value: string): Provider {
  if (!VALID_PROVIDERS.has(value as Provider)) {
    throw new CliError(
      `Unknown provider '${value}'. Use one of: openai, anthropic, openrouter`,
      EXIT.VALIDATION,
      'BAD_PROVIDER',
    );
  }
  return value as Provider;
}

export function providersCommand(getFlags: () => GlobalFlags): Command {
  const providers = new Command('providers').description(
    'Manage AI provider API keys (openai / anthropic / openrouter)',
  );

  providers
    .command('list')
    .description('List configured providers (keys are never returned)')
    .action(async () => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        requireToken(client);
        const data = await client.request<{ providers: ProviderRow[] }>('/api/providers');
        if (flags.json) emitJson(data.providers, flags);
        else
          emitText(
            renderTable({
              head: ['Provider', 'Created', 'Updated'],
              rows: data.providers.map((p) => [p.provider, p.created_at, p.updated_at]),
            }),
            flags,
          );
      });
    });

  providers
    .command('set')
    .description('Store or replace the API key for a provider')
    .requiredOption('--provider <provider>', 'openai|anthropic|openrouter')
    .requiredOption('--key <key>', 'API key (use a shell here-string to avoid history capture)')
    .action(async (opts: { provider: string; key: string }) => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const provider = asProvider(opts.provider);
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        requireToken(client);
        const data = await client.request<{ provider: ProviderRow }>('/api/providers', {
          method: 'POST',
          body: { provider, apiKey: opts.key },
        });
        if (flags.json) emitJson(data.provider, flags);
        else emitText(`Saved ${provider} key`, flags);
      });
    });

  providers
    .command('test <provider>')
    .description('Round-trip a real auth call against the provider using the stored key')
    .action(async (provider: string) => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const p = asProvider(provider);
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        requireToken(client);
        const data = await client.request<unknown>(`/api/providers/${p}/test`, { method: 'POST' });
        if (flags.json) emitJson(data, flags);
        else emitText(JSON.stringify(data, null, 2), flags);
      });
    });

  providers
    .command('delete <provider>')
    .description('Remove the stored API key for a provider')
    .action(async (provider: string) => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const p = asProvider(provider);
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        requireToken(client);
        const data = await client.request<{ provider: string; removed: boolean }>(
          `/api/providers/${p}`,
          { method: 'DELETE' },
        );
        if (flags.json) emitJson(data, flags);
        else emitText(`Removed ${p} key`, flags);
      });
    });

  return providers;
}
