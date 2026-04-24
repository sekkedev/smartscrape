/** @type {import('node-pg-migrate').MigrationBuilder} */

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE google_connections (
      id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id                   UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      access_token_encrypted    TEXT        NOT NULL,
      refresh_token_encrypted   TEXT        NOT NULL,
      token_expires_at          TIMESTAMPTZ,
      connected_email           TEXT,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TRIGGER google_connections_set_updated_at
      BEFORE UPDATE ON google_connections
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE notification_log (
      id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      job_id    UUID        NOT NULL REFERENCES scrape_jobs(id) ON DELETE CASCADE,
      run_id    UUID        NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
      channel   TEXT        NOT NULL CHECK (channel IN ('email', 'telegram')),
      type      TEXT        NOT NULL CHECK (type IN ('change_detected', 'job_failed', 'job_completed')),
      message   TEXT,
      sent_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX notification_log_user_id_sent_at_idx ON notification_log (user_id, sent_at DESC);
    CREATE INDEX notification_log_job_id_idx ON notification_log (job_id);
    CREATE INDEX notification_log_run_id_idx ON notification_log (run_id);

    CREATE TABLE settings (
      id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key      TEXT NOT NULL,
      value    TEXT NOT NULL,
      UNIQUE (user_id, key)
    );

    CREATE INDEX settings_user_id_idx ON settings (user_id);
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS settings;
    DROP TABLE IF EXISTS notification_log;
    DROP TRIGGER IF EXISTS google_connections_set_updated_at ON google_connections;
    DROP TABLE IF EXISTS google_connections;
  `);
};
