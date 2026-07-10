/** @type {import('node-pg-migrate').MigrationBuilder} */

export const up = (pgm) => {
  pgm.sql(`
    -- Queue-job identity on runs: scheduled BullMQ jobs carry no runId, so a
    -- stalled-job retry used to create a second scrape_runs row while the
    -- first sat in 'scraping' forever. The worker now finds-or-creates the
    -- run by the BullMQ job id, making retries attach instead of duplicate.
    ALTER TABLE scrape_runs ADD COLUMN queue_job_id TEXT;

    CREATE INDEX scrape_runs_queue_job_id_idx
      ON scrape_runs (queue_job_id)
      WHERE queue_job_id IS NOT NULL;

    -- New terminal classification for runs orphaned by a crash/restart and
    -- closed by the stale-run sweeper. Set explicitly by the sweeper only —
    -- the message classifier never produces it.
    ALTER TABLE scrape_runs DROP CONSTRAINT IF EXISTS scrape_runs_error_type_check;
    ALTER TABLE scrape_runs
      ADD CONSTRAINT scrape_runs_error_type_check
        CHECK (
          error_type IS NULL
          OR error_type IN (
            'timeout',
            'blocked',
            'parse_error',
            'ai_error',
            'network_error',
            'quota_error',
            'interrupted',
            'unknown'
          )
        );
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE scrape_runs DROP CONSTRAINT IF EXISTS scrape_runs_error_type_check;
    ALTER TABLE scrape_runs
      ADD CONSTRAINT scrape_runs_error_type_check
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
    DROP INDEX IF EXISTS scrape_runs_queue_job_id_idx;
    ALTER TABLE scrape_runs DROP COLUMN IF EXISTS queue_job_id;
  `);
};
