/** @type {import('node-pg-migrate').MigrationBuilder} */

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE scrape_jobs (
      id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id              UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name                 TEXT        NOT NULL,
      urls                 JSONB       NOT NULL,
      extraction_prompt    TEXT        NOT NULL,
      extraction_schema    JSONB,
      scrape_method        TEXT        NOT NULL DEFAULT 'auto'
                             CHECK (scrape_method IN ('auto', 'playwright', 'cheerio')),
      schedule             TEXT,
      enabled              BOOLEAN     NOT NULL DEFAULT true,
      notification_rules   JSONB       NOT NULL DEFAULT '[]'::jsonb,
      notify_channels      JSONB       NOT NULL DEFAULT '[]'::jsonb,
      comparison_key       TEXT,
      ai_provider          TEXT        NOT NULL DEFAULT 'openrouter',
      ai_model             TEXT        NOT NULL DEFAULT 'gpt-4o-mini',
      google_sheet_id      TEXT,
      sheet_tab_name       TEXT,
      setup_method         TEXT        NOT NULL DEFAULT 'ai'
                             CHECK (setup_method IN ('ai', 'manual')),
      last_run_at          TIMESTAMPTZ,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX scrape_jobs_user_id_enabled_idx ON scrape_jobs (user_id, enabled);
    CREATE INDEX scrape_jobs_schedule_idx ON scrape_jobs (schedule) WHERE schedule IS NOT NULL;
    CREATE INDEX scrape_jobs_last_run_at_idx ON scrape_jobs (last_run_at DESC NULLS LAST);

    CREATE TRIGGER scrape_jobs_set_updated_at
      BEFORE UPDATE ON scrape_jobs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TABLE scrape_runs (
      id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id            UUID        NOT NULL REFERENCES scrape_jobs(id) ON DELETE CASCADE,
      status            TEXT        NOT NULL
                          CHECK (status IN ('pending', 'scraping', 'extracting', 'exporting', 'completed', 'failed')),
      urls_scraped      INTEGER     NOT NULL DEFAULT 0,
      items_extracted   INTEGER     NOT NULL DEFAULT 0,
      tokens_used       INTEGER     NOT NULL DEFAULT 0,
      error_message     TEXT,
      started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at      TIMESTAMPTZ
    );

    CREATE INDEX scrape_runs_job_id_started_at_idx ON scrape_runs (job_id, started_at DESC);
    CREATE INDEX scrape_runs_status_idx ON scrape_runs (status);

    CREATE TABLE extracted_data (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id      UUID        NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
      job_id      UUID        NOT NULL REFERENCES scrape_jobs(id) ON DELETE CASCADE,
      source_url  TEXT        NOT NULL,
      data        JSONB       NOT NULL,
      data_hash   TEXT        NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX extracted_data_run_id_idx ON extracted_data (run_id);
    CREATE INDEX extracted_data_job_id_created_at_idx ON extracted_data (job_id, created_at DESC);
    CREATE INDEX extracted_data_data_hash_idx ON extracted_data (data_hash);

    CREATE TABLE job_setup_logs (
      id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id          UUID        NOT NULL REFERENCES scrape_jobs(id) ON DELETE CASCADE,
      user_goal       TEXT        NOT NULL,
      ai_suggestion   JSONB       NOT NULL,
      accepted        BOOLEAN     NOT NULL DEFAULT false,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX job_setup_logs_job_id_idx ON job_setup_logs (job_id);
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS job_setup_logs;
    DROP TABLE IF EXISTS extracted_data;
    DROP TABLE IF EXISTS scrape_runs;
    DROP TRIGGER IF EXISTS scrape_jobs_set_updated_at ON scrape_jobs;
    DROP TABLE IF EXISTS scrape_jobs;
  `);
};
