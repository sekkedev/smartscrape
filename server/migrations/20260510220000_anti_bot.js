/** @type {import('node-pg-migrate').MigrationBuilder} */

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE scrape_jobs
      ADD COLUMN stealth_mode    BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN proxy_url       TEXT,
      ADD COLUMN pacing_min_ms   INTEGER
        CHECK (pacing_min_ms IS NULL OR pacing_min_ms BETWEEN 0 AND 600000),
      ADD COLUMN pacing_max_ms   INTEGER
        CHECK (pacing_max_ms IS NULL OR pacing_max_ms BETWEEN 0 AND 600000),
      ADD CONSTRAINT scrape_jobs_pacing_order
        CHECK (
          pacing_min_ms IS NULL
          OR pacing_max_ms IS NULL
          OR pacing_min_ms <= pacing_max_ms
        );
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE scrape_jobs
      DROP CONSTRAINT IF EXISTS scrape_jobs_pacing_order,
      DROP COLUMN IF EXISTS pacing_max_ms,
      DROP COLUMN IF EXISTS pacing_min_ms,
      DROP COLUMN IF EXISTS proxy_url,
      DROP COLUMN IF EXISTS stealth_mode;
  `);
};
