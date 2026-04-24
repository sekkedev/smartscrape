import { getPool } from '../config/database.js';

export type SettingsMap = Record<string, string>;

export async function listForUser(userId: string): Promise<SettingsMap> {
  const { rows } = await getPool().query<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE user_id = $1`,
    [userId],
  );
  const out: SettingsMap = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function upsertMany(userId: string, patch: SettingsMap): Promise<SettingsMap> {
  const entries = Object.entries(patch);
  if (entries.length > 0) {
    const values: unknown[] = [];
    const placeholders = entries.map(([k, v], i) => {
      const base = i * 3;
      values.push(userId, k, v);
      return `($${base + 1}, $${base + 2}, $${base + 3})`;
    });
    await getPool().query(
      `INSERT INTO settings (user_id, key, value) VALUES ${placeholders.join(', ')}
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value`,
      values,
    );
  }
  return listForUser(userId);
}
