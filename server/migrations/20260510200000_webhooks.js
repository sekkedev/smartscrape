/** @type {import('node-pg-migrate').MigrationBuilder} */

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE scrape_jobs
      ADD COLUMN webhook_url               TEXT,
      ADD COLUMN webhook_secret_encrypted  TEXT;

    ALTER TABLE scrape_runs
      ADD COLUMN webhook_status        TEXT
        CHECK (webhook_status IN ('success', 'failed') OR webhook_status IS NULL),
      ADD COLUMN webhook_attempts      INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN webhook_last_error    TEXT,
      ADD COLUMN webhook_delivered_at  TIMESTAMPTZ;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE scrape_runs
      DROP COLUMN IF EXISTS webhook_delivered_at,
      DROP COLUMN IF EXISTS webhook_last_error,
      DROP COLUMN IF EXISTS webhook_attempts,
      DROP COLUMN IF EXISTS webhook_status;

    ALTER TABLE scrape_jobs
      DROP COLUMN IF EXISTS webhook_secret_encrypted,
      DROP COLUMN IF EXISTS webhook_url;
  `);
};
