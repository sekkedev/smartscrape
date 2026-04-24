/** @type {import('node-pg-migrate').MigrationBuilder} */

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE scrape_runs
      ADD COLUMN export_error TEXT;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE scrape_runs
      DROP COLUMN IF EXISTS export_error;
  `);
};
