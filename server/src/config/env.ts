import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Walk up from this file to find the nearest .env (repo root for dev, server dir for prod).
function findEnvFile(): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const envPath = findEnvFile();
if (envPath) {
  loadDotenv({ path: envPath });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith('replace-me')) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: Number.parseInt(optional('PORT', '3000'), 10),
  databaseUrl: optional('DATABASE_URL'),
  redisUrl: optional('REDIS_URL'),
  appUrl: optional('APP_URL', 'http://localhost:5173'),
  apiUrl: optional('API_URL', 'http://localhost:3000'),
  smtp: {
    host: optional('SMTP_HOST'),
    port: Number.parseInt(optional('SMTP_PORT', '587'), 10),
    user: optional('SMTP_USER'),
    pass: optional('SMTP_PASS'),
    from: optional('EMAIL_FROM', 'noreply@smartscrape.local'),
  },
  resend: {
    apiKey: optional('RESEND_API_KEY'),
  },
};

type Secrets = {
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  encryptionKey: string;
};

let cachedSecrets: Secrets | null = null;

/**
 * Read and validate all runtime secrets. Throws if any are missing or still
 * placeholder values. Cache so subsequent calls are free.
 */
export function requireSecrets(): Secrets {
  if (cachedSecrets) return cachedSecrets;
  const encryptionKeyHex = required('ENCRYPTION_KEY');
  if (!/^[0-9a-fA-F]{64}$/.test(encryptionKeyHex)) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes hex-encoded (64 hex chars)');
  }
  cachedSecrets = {
    jwtAccessSecret: required('JWT_SECRET'),
    jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
    encryptionKey: encryptionKeyHex,
  };
  return cachedSecrets;
}
