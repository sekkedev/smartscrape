import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, unlinkSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

export type StoredConfig = {
  url: string;
  accessToken: string | null;
  refreshCookie: string | null;
  refreshExpiresAt: string | null;
  email: string | null;
};

const CONFIG_DIR = join(homedir(), '.smartscrape');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULT: StoredConfig = {
  url: 'http://localhost:3000',
  accessToken: null,
  refreshCookie: null,
  refreshExpiresAt: null,
  email: null,
};

export function loadConfig(): StoredConfig {
  if (!existsSync(CONFIG_FILE)) return { ...DEFAULT };
  try {
    const raw = readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredConfig>;
    return { ...DEFAULT, ...parsed };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveConfig(cfg: StoredConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  // chmod is a no-op on Windows; tighten on POSIX where it matters.
  if (platform() !== 'win32') {
    try {
      chmodSync(CONFIG_FILE, 0o600);
    } catch {
      // tolerate non-POSIX filesystems
    }
  }
}

export function clearConfig(): void {
  if (existsSync(CONFIG_FILE)) unlinkSync(CONFIG_FILE);
}

export type ResolvedSession = {
  url: string;
  /** A short-lived JWT, when one is available. Null when authenticating via PAT. */
  token: string | null;
  refreshCookie: string | null;
  email: string | null;
  /** A personal access token (`sst_…`), used in `X-API-Key`. Wins over JWT when present. */
  apiKey: string | null;
};

/**
 * Layer env vars on top of the stored config. Env wins so cron jobs and agents
 * can override without touching ~/.smartscrape/config.json. The API-key path
 * has its own env var (SMARTSCRAPE_API_KEY) so headless callers can avoid the
 * JWT refresh dance entirely.
 */
export function resolveSession(overrides?: {
  url?: string;
  token?: string;
  apiKey?: string;
}): ResolvedSession {
  const stored = loadConfig();
  const url = overrides?.url ?? process.env.SMARTSCRAPE_URL ?? stored.url;
  const token = overrides?.token ?? process.env.SMARTSCRAPE_TOKEN ?? stored.accessToken;
  const apiKey = overrides?.apiKey ?? process.env.SMARTSCRAPE_API_KEY ?? null;
  return {
    url: url.replace(/\/$/, ''),
    token: token ?? null,
    refreshCookie: stored.refreshCookie,
    email: stored.email,
    apiKey,
  };
}

export function configFilePath(): string {
  return CONFIG_FILE;
}
