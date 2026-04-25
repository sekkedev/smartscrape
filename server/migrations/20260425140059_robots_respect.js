/** @type {import('node-pg-migrate').MigrationBuilder} */

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE scrape_jobs
      ADD COLUMN respect_robots_txt BOOLEAN NOT NULL DEFAULT true;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE scrape_jobs DROP COLUMN respect_robots_txt;
  `);
};
