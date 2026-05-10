import { Command } from 'commander';
import { createClient, extractRefreshCookie } from '../api.js';
import { clearConfig, configFilePath, loadConfig, saveConfig } from '../config.js';
import {
  CliError,
  EXIT,
  ageString,
  emitJson,
  emitText,
  renderTable,
  runCommand,
  type GlobalFlags,
} from '../output.js';
import type { AccessToken, ApiResponse, UserPublic } from '../types.js';

type LoginResponse = {
  user: UserPublic;
  accessToken: string;
  refreshExpiresAt: string;
};

export function authCommand(getFlags: () => GlobalFlags): Command {
  const auth = new Command('auth').description('Authenticate against a SmartScrape server');

  auth
    .command('login')
    .description('Sign in with email + password and persist a token to ~/.smartscrape/config.json')
    .requiredOption('--email <email>', 'Account email')
    .requiredOption('--password <password>', 'Account password')
    .option('--url <url>', 'Server URL (default: http://localhost:3000 or $SMARTSCRAPE_URL)')
    .action(async (opts: { email: string; password: string; url?: string }) => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const url = opts.url ?? process.env.SMARTSCRAPE_URL ?? loadConfig().url;
        const target = new URL('/api/auth/login', url).toString();
        const res = await fetch(target, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ email: opts.email, password: opts.password }),
        });
        const body = (await res.json().catch(() => null)) as ApiResponse<LoginResponse> | null;
        if (!res.ok || !body || !body.success) {
          const code = body && !body.success ? body.error.code : 'LOGIN_FAILED';
          const message =
            body && !body.success ? body.error.message : `Login failed (HTTP ${res.status})`;
          throw new CliError(message, res.status === 401 ? EXIT.AUTH : EXIT.ERROR, code);
        }
        const setCookie = res.headers.get('set-cookie');
        const refreshCookie = setCookie ? extractRefreshCookie(setCookie) : null;
        saveConfig({
          url: url.replace(/\/$/, ''),
          accessToken: body.data.accessToken,
          refreshCookie,
          refreshExpiresAt: body.data.refreshExpiresAt,
          email: body.data.user.email,
        });
        if (flags.json) {
          emitJson(
            {
              email: body.data.user.email,
              configPath: configFilePath(),
              refreshExpiresAt: body.data.refreshExpiresAt,
            },
            flags,
          );
        } else {
          emitText(
            `Signed in as ${body.data.user.email}. Config written to ${configFilePath()}.`,
            flags,
          );
        }
      });
    });

  auth
    .command('logout')
    .description('Revoke the refresh token on the server and clear local config')
    .action(async () => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const stored = loadConfig();
        if (stored.refreshCookie) {
          try {
            await fetch(new URL('/api/auth/logout', stored.url).toString(), {
              method: 'POST',
              headers: {
                accept: 'application/json',
                cookie: stored.refreshCookie,
              },
            });
          } catch {
            // best-effort revoke; we still clear the local config below
          }
        }
        clearConfig();
        if (flags.json) emitJson({ loggedOut: true }, flags);
        else emitText('Signed out and cleared local config.', flags);
      });
    });

  auth
    .command('whoami')
    .description('Show the currently authenticated user')
    .action(async () => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        if (!client.session.token && !client.session.apiKey) {
          throw new CliError(
            "Not signed in. Run 'smartscrape auth login', or set SMARTSCRAPE_API_KEY / SMARTSCRAPE_TOKEN.",
            EXIT.AUTH,
            'NO_TOKEN',
          );
        }
        const data = await client.request<{ user: UserPublic }>('/api/auth/me');
        if (flags.json) {
          emitJson(data.user, flags);
        } else {
          emitText(
            `${data.user.email}${data.user.name ? ` (${data.user.name})` : ''} — verified: ${data.user.email_verified}`,
            flags,
          );
        }
      });
    });

  const tokens = auth
    .command('tokens')
    .description('Manage personal access tokens (PATs) for headless authentication');

  tokens
    .command('list')
    .description('List access tokens for the authenticated user (plaintexts are never shown)')
    .action(async () => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        if (!client.session.token && !client.session.apiKey) {
          throw new CliError(
            "Not signed in. Run 'smartscrape auth login' first.",
            EXIT.AUTH,
            'NO_TOKEN',
          );
        }
        const data = await client.request<{ tokens: AccessToken[] }>('/api/auth/access-tokens');
        if (flags.json) {
          emitJson(data.tokens, flags);
          return;
        }
        if (data.tokens.length === 0) {
          emitText('(no access tokens — create one with `auth tokens create`)', flags);
          return;
        }
        emitText(
          renderTable({
            head: ['ID', 'Name', 'Prefix', 'Last used', 'Created', 'Revoked'],
            rows: data.tokens.map((t) => [
              t.id.slice(0, 8),
              t.name,
              t.prefix,
              ageString(t.last_used_at),
              ageString(t.created_at),
              t.revoked_at ? ageString(t.revoked_at) : '—',
            ]),
          }),
          flags,
        );
      });
    });

  tokens
    .command('create')
    .description('Mint a new access token. Plaintext is shown once — capture it now.')
    .requiredOption('--name <name>', 'Human-readable label (e.g. "ci-runner", "homelab")')
    .action(async (opts: { name: string }) => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        if (!client.session.token && !client.session.apiKey) {
          throw new CliError(
            "Not signed in. Run 'smartscrape auth login' first.",
            EXIT.AUTH,
            'NO_TOKEN',
          );
        }
        const data = await client.request<{ token: AccessToken & { plaintext: string } }>(
          '/api/auth/access-tokens',
          { method: 'POST', body: { name: opts.name } },
        );
        if (flags.json) {
          emitJson(data.token, flags);
          return;
        }
        // Plaintext goes to stdout so the user can pipe it into a secret store;
        // status banner goes to stderr so they can `> token.txt` cleanly.
        process.stderr.write(
          `Created access token '${data.token.name}' (id=${data.token.id}). Plaintext shown ONCE on the next line:\n`,
        );
        process.stdout.write(data.token.plaintext + '\n');
      });
    });

  tokens
    .command('revoke <id>')
    .description('Revoke an access token by id (or short id from `tokens list`)')
    .action(async (id: string) => {
      const flags = getFlags();
      await runCommand(flags, async () => {
        const client = createClient({
          url: flags.serverUrl,
          token: flags.token,
          apiKey: flags.apiKey,
        });
        if (!client.session.token && !client.session.apiKey) {
          throw new CliError(
            "Not signed in. Run 'smartscrape auth login' first.",
            EXIT.AUTH,
            'NO_TOKEN',
          );
        }
        // Allow the short 8-char id from `tokens list` by resolving against
        // the full list when the input isn't a UUID.
        let fullId = id;
        if (!/^[0-9a-f-]{36}$/i.test(id)) {
          const list = await client.request<{ tokens: AccessToken[] }>('/api/auth/access-tokens');
          const match = list.tokens.find((t) => t.id.startsWith(id));
          if (!match) {
            throw new CliError(
              `No access token with id starting with '${id}'`,
              EXIT.NOT_FOUND,
              'TOKEN_NOT_FOUND',
            );
          }
          fullId = match.id;
        }
        await client.request<{ revoked: boolean }>(`/api/auth/access-tokens/${fullId}`, {
          method: 'DELETE',
        });
        if (flags.json) emitJson({ id: fullId, revoked: true }, flags);
        else emitText(`Revoked ${fullId}`, flags);
      });
    });

  return auth;
}
