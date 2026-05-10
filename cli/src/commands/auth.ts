import { Command } from 'commander';
import { createClient, extractRefreshCookie } from '../api.js';
import { clearConfig, configFilePath, loadConfig, saveConfig } from '../config.js';
import {
  CliError,
  EXIT,
  emitJson,
  emitText,
  runCommand,
  type GlobalFlags,
} from '../output.js';
import type { ApiResponse, UserPublic } from '../types.js';

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
        const client = createClient({ url: flags.url, token: flags.token });
        if (!client.session.token) {
          throw new CliError(
            "Not signed in. Run 'smartscrape auth login' or set SMARTSCRAPE_TOKEN.",
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

  return auth;
}
