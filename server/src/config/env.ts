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
  if (!value) {
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
};

export function requireSecrets(): void {
  // Called from places that need them; the health check route stays tolerant.
  required('JWT_SECRET');
  required('JWT_REFRESH_SECRET');
  required('ENCRYPTION_KEY');
}
