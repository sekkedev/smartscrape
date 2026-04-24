import { getPool } from '../config/database.js';

export type RefreshTokenRow = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked: boolean;
  created_at: Date;
};

export async function createRefreshToken(args: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<RefreshTokenRow> {
  const { rows } = await getPool().query<RefreshTokenRow>(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [args.userId, args.tokenHash, args.expiresAt],
  );
  return rows[0]!;
}

export async function findActiveByHash(tokenHash: string): Promise<RefreshTokenRow | null> {
  const { rows } = await getPool().query<RefreshTokenRow>(
    `SELECT * FROM refresh_tokens
      WHERE token_hash = $1
        AND revoked = false
        AND expires_at > now()
      LIMIT 1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function revokeById(id: string): Promise<void> {
  await getPool().query(`UPDATE refresh_tokens SET revoked = true WHERE id = $1`, [id]);
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await getPool().query(
    `UPDATE refresh_tokens SET revoked = true WHERE user_id = $1 AND revoked = false`,
    [userId],
  );
}
