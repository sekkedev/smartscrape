import { getPool } from '../config/database.js';

export type PersonalAccessTokenRow = {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  prefix: string;
  last_used_at: Date | null;
  created_at: Date;
  revoked_at: Date | null;
};

export type PersonalAccessTokenDTO = {
  id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

export function toDTO(row: PersonalAccessTokenRow): PersonalAccessTokenDTO {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    last_used_at: row.last_used_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    revoked_at: row.revoked_at?.toISOString() ?? null,
  };
}

export async function createToken(args: {
  userId: string;
  name: string;
  tokenHash: string;
  prefix: string;
}): Promise<PersonalAccessTokenRow> {
  const { rows } = await getPool().query<PersonalAccessTokenRow>(
    `INSERT INTO personal_access_tokens (user_id, name, token_hash, prefix)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [args.userId, args.name, args.tokenHash, args.prefix],
  );
  return rows[0]!;
}

export async function listForUser(userId: string): Promise<PersonalAccessTokenRow[]> {
  const { rows } = await getPool().query<PersonalAccessTokenRow>(
    `SELECT * FROM personal_access_tokens
      WHERE user_id = $1
      ORDER BY revoked_at IS NULL DESC, created_at DESC`,
    [userId],
  );
  return rows;
}

/**
 * Lookup by hash for the auth-middleware hot path. Filters out revoked tokens
 * so a leaked revoked token can never be replayed. The partial index on
 * `token_hash WHERE revoked_at IS NULL` keeps this O(log N).
 */
export async function findActiveByHash(tokenHash: string): Promise<PersonalAccessTokenRow | null> {
  const { rows } = await getPool().query<PersonalAccessTokenRow>(
    `SELECT * FROM personal_access_tokens
      WHERE token_hash = $1 AND revoked_at IS NULL
      LIMIT 1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function revoke(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `UPDATE personal_access_tokens
        SET revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function touchLastUsed(id: string): Promise<void> {
  await getPool().query(`UPDATE personal_access_tokens SET last_used_at = now() WHERE id = $1`, [
    id,
  ]);
}
