import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    if (!env.databaseUrl) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({ connectionString: env.databaseUrl });
    pool.on('error', (err) => {
      console.error('[db] unexpected pool error', err);
    });
  }
  return pool;
}

export async function pingDatabase(): Promise<{ ok: boolean; error?: string }> {
  if (!env.databaseUrl) {
    return { ok: false, error: 'DATABASE_URL not configured' };
  }
  try {
    const result = await getPool().query('SELECT 1 AS ok');
    return { ok: result.rows[0]?.ok === 1 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
