import { getPool } from '../config/database.js';

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  email_verified: boolean;
  verification_token: string | null;
  reset_token: string | null;
  reset_token_expires: Date | null;
  telegram_chat_id: string | null;
  created_at: Date;
  updated_at: Date;
};

export type PublicUser = {
  id: string;
  email: string;
  name: string | null;
  email_verified: boolean;
  telegram_chat_id: string | null;
  created_at: string;
  updated_at: string;
};

export function toPublic(u: UserRow): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    email_verified: u.email_verified,
    telegram_chat_id: u.telegram_chat_id,
    created_at: u.created_at.toISOString(),
    updated_at: u.updated_at.toISOString(),
  };
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await getPool().query<UserRow>(`SELECT * FROM users WHERE email = $1 LIMIT 1`, [
    email.toLowerCase(),
  ]);
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const { rows } = await getPool().query<UserRow>(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [
    id,
  ]);
  return rows[0] ?? null;
}

export async function findUserByVerificationToken(tokenHash: string): Promise<UserRow | null> {
  const { rows } = await getPool().query<UserRow>(
    `SELECT * FROM users WHERE verification_token = $1 LIMIT 1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function findUserByResetToken(tokenHash: string): Promise<UserRow | null> {
  const { rows } = await getPool().query<UserRow>(
    `SELECT * FROM users
     WHERE reset_token = $1 AND reset_token_expires > now()
     LIMIT 1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function createUser(args: {
  email: string;
  passwordHash: string;
  name: string | null;
  verificationTokenHash: string;
}): Promise<UserRow> {
  const { rows } = await getPool().query<UserRow>(
    `INSERT INTO users (email, password_hash, name, verification_token)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [args.email.toLowerCase(), args.passwordHash, args.name, args.verificationTokenHash],
  );
  return rows[0]!;
}

export async function markEmailVerified(userId: string): Promise<void> {
  await getPool().query(
    `UPDATE users SET email_verified = true, verification_token = NULL WHERE id = $1`,
    [userId],
  );
}

export async function setResetToken(
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await getPool().query(
    `UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3`,
    [tokenHash, expiresAt, userId],
  );
}

export async function clearResetToken(userId: string): Promise<void> {
  await getPool().query(
    `UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE id = $1`,
    [userId],
  );
}

export async function updatePassword(userId: string, passwordHash: string): Promise<void> {
  await getPool().query(
    `UPDATE users
       SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL
     WHERE id = $2`,
    [passwordHash, userId],
  );
}

export type UpdateProfileArgs = {
  name?: string | null;
  telegramChatId?: string | null;
};

export async function updateProfile(userId: string, args: UpdateProfileArgs): Promise<UserRow> {
  // Build dynamic UPDATE from only provided keys.
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (args.name !== undefined) {
    sets.push(`name = $${sets.length + 1}`);
    vals.push(args.name);
  }
  if (args.telegramChatId !== undefined) {
    sets.push(`telegram_chat_id = $${sets.length + 1}`);
    vals.push(args.telegramChatId);
  }
  if (sets.length === 0) {
    const existing = await findUserById(userId);
    if (!existing) throw new Error('User not found');
    return existing;
  }
  vals.push(userId);
  const { rows } = await getPool().query<UserRow>(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
    vals,
  );
  return rows[0]!;
}

export async function deleteUser(userId: string): Promise<void> {
  await getPool().query(`DELETE FROM users WHERE id = $1`, [userId]);
}
