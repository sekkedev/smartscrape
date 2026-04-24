import { getPool } from '../config/database.js';

export const PROVIDERS = ['openai', 'anthropic', 'openrouter'] as const;
export type Provider = (typeof PROVIDERS)[number];

export type ApiKeyRow = {
  id: string;
  user_id: string;
  provider: Provider;
  api_key_encrypted: string;
  is_active: boolean;
  created_at: Date;
};

export type ProviderSummary = {
  provider: Provider;
  connected: boolean;
  created_at: string;
};

export async function listByUser(userId: string): Promise<ProviderSummary[]> {
  const { rows } = await getPool().query<Pick<ApiKeyRow, 'provider' | 'created_at' | 'is_active'>>(
    `SELECT provider, created_at, is_active FROM api_keys WHERE user_id = $1 ORDER BY provider`,
    [userId],
  );
  return rows.map((r) => ({
    provider: r.provider,
    connected: r.is_active,
    created_at: r.created_at.toISOString(),
  }));
}

export async function upsertForUser(
  userId: string,
  provider: Provider,
  encrypted: string,
): Promise<ProviderSummary> {
  const { rows } = await getPool().query<Pick<ApiKeyRow, 'provider' | 'created_at' | 'is_active'>>(
    `INSERT INTO api_keys (user_id, provider, api_key_encrypted)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, provider)
       DO UPDATE SET api_key_encrypted = EXCLUDED.api_key_encrypted,
                     is_active = true,
                     created_at = now()
     RETURNING provider, created_at, is_active`,
    [userId, provider, encrypted],
  );
  const row = rows[0]!;
  return {
    provider: row.provider,
    connected: row.is_active,
    created_at: row.created_at.toISOString(),
  };
}

export async function findForUser(userId: string, provider: Provider): Promise<ApiKeyRow | null> {
  const { rows } = await getPool().query<ApiKeyRow>(
    `SELECT * FROM api_keys WHERE user_id = $1 AND provider = $2 LIMIT 1`,
    [userId, provider],
  );
  return rows[0] ?? null;
}

export async function deleteForUser(userId: string, provider: Provider): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `DELETE FROM api_keys WHERE user_id = $1 AND provider = $2`,
    [userId, provider],
  );
  return (rowCount ?? 0) > 0;
}
