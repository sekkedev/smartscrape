/** @type {import('node-pg-migrate').MigrationBuilder} */

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE personal_access_tokens (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name          TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
      token_hash    TEXT        NOT NULL UNIQUE,
      prefix        TEXT        NOT NULL,
      last_used_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked_at    TIMESTAMPTZ
    );

    CREATE INDEX personal_access_tokens_user_id_idx
      ON personal_access_tokens (user_id);

    -- Filter index that only covers live tokens — auth path is hottest.
    CREATE INDEX personal_access_tokens_active_hash_idx
      ON personal_access_tokens (token_hash)
      WHERE revoked_at IS NULL;
  `);
};

export const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS personal_access_tokens;`);
};
