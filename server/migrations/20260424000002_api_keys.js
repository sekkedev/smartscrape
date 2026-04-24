/** @type {import('node-pg-migrate').MigrationBuilder} */

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE api_keys (
      id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id            UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider           TEXT        NOT NULL CHECK (provider IN ('openai', 'anthropic', 'openrouter')),
      api_key_encrypted  TEXT        NOT NULL,
      is_active          BOOLEAN     NOT NULL DEFAULT true,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, provider)
    );

    CREATE INDEX api_keys_user_id_idx ON api_keys (user_id);
  `);
};

export const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS api_keys;`);
};
