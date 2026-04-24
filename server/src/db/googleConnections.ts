import { getPool } from '../config/database.js';

export type GoogleConnectionRow = {
  id: string;
  user_id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: Date | null;
  connected_email: string | null;
  scope: string | null;
  created_at: Date;
  updated_at: Date;
};

export async function findConnection(userId: string): Promise<GoogleConnectionRow | null> {
  const { rows } = await getPool().query<GoogleConnectionRow>(
    `SELECT * FROM google_connections WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function upsertConnection(args: {
  userId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  tokenExpiresAt: Date | null;
  connectedEmail: string | null;
  scope: string | null;
}): Promise<GoogleConnectionRow> {
  const { rows } = await getPool().query<GoogleConnectionRow>(
    `INSERT INTO google_connections
       (user_id, access_token_encrypted, refresh_token_encrypted, token_expires_at, connected_email, scope)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id)
       DO UPDATE SET access_token_encrypted = EXCLUDED.access_token_encrypted,
                     refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
                     token_expires_at = EXCLUDED.token_expires_at,
                     connected_email = EXCLUDED.connected_email,
                     scope = EXCLUDED.scope
     RETURNING *`,
    [
      args.userId,
      args.accessTokenEncrypted,
      args.refreshTokenEncrypted,
      args.tokenExpiresAt,
      args.connectedEmail,
      args.scope,
    ],
  );
  return rows[0]!;
}

export async function updateAccessToken(
  userId: string,
  accessTokenEncrypted: string,
  tokenExpiresAt: Date,
): Promise<void> {
  await getPool().query(
    `UPDATE google_connections
        SET access_token_encrypted = $1, token_expires_at = $2
      WHERE user_id = $3`,
    [accessTokenEncrypted, tokenExpiresAt, userId],
  );
}

export async function deleteConnection(userId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `DELETE FROM google_connections WHERE user_id = $1`,
    [userId],
  );
  return (rowCount ?? 0) > 0;
}
