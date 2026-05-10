/** @type {import('node-pg-migrate').MigrationBuilder} */

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE scrape_runs
      ADD COLUMN error_type TEXT
        CHECK (
          error_type IS NULL
          OR error_type IN (
            'timeout',
            'blocked',
            'parse_error',
            'ai_error',
            'network_error',
            'quota_error',
            'unknown'
          )
        );

    -- Index just the failed runs so the "rolling failure window per job"
    -- lookup is O(log N) regardless of how many successful runs sit on the table.
    CREATE INDEX scrape_runs_failed_by_job_idx
      ON scrape_runs (job_id, started_at DESC)
      WHERE status = 'failed';
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS scrape_runs_failed_by_job_idx;
    ALTER TABLE scrape_runs DROP COLUMN IF EXISTS error_type;
  `);
};
