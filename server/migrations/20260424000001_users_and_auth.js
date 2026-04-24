/** @type {import('node-pg-migrate').MigrationBuilder} */

export const up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    -- Generic trigger that keeps updated_at current on row updates.
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TABLE users (
      id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      email                TEXT        UNIQUE NOT NULL,
      password_hash        TEXT        NOT NULL,
      name                 TEXT,
      email_verified       BOOLEAN     NOT NULL DEFAULT false,
      verification_token   TEXT,
      reset_token          TEXT,
      reset_token_expires  TIMESTAMPTZ,
      telegram_chat_id     TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX users_verification_token_idx
      ON users (verification_token)
      WHERE verification_token IS NOT NULL;

    CREATE INDEX users_reset_token_idx
      ON users (reset_token)
      WHERE reset_token IS NOT NULL;

    CREATE TRIGGER users_set_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE refresh_tokens (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash  TEXT        NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      revoked     BOOLEAN     NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE UNIQUE INDEX refresh_tokens_token_hash_uidx ON refresh_tokens (token_hash);
    CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id);
    CREATE INDEX refresh_tokens_expires_at_idx ON refresh_tokens (expires_at);
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS refresh_tokens;
    DROP TRIGGER IF EXISTS users_set_updated_at ON users;
    DROP TABLE IF EXISTS users;
    DROP FUNCTION IF EXISTS set_updated_at();
    -- pgcrypto is left installed; other migrations may rely on it.
  `);
};
