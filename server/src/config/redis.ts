import { Redis } from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';
import { env } from './env.js';

let client: RedisClient | null = null;

export function getRedis(): RedisClient {
  if (!client) {
    if (!env.redisUrl) {
      throw new Error('REDIS_URL is not set');
    }
    client = new Redis(env.redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    client.on('error', (err: Error) => {
      console.error('[redis] error', err.message);
    });
  }
  return client;
}

export async function pingRedis(): Promise<{ ok: boolean; error?: string }> {
  if (!env.redisUrl) {
    return { ok: false, error: 'REDIS_URL not configured' };
  }
  try {
    const redis = getRedis();
    if (redis.status === 'wait' || redis.status === 'end') {
      await redis.connect();
    }
    const reply = await redis.ping();
    return { ok: reply === 'PONG' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => undefined);
    client = null;
  }
}
