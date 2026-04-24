/** @type {import('node-pg-migrate').MigrationBuilder} */

export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE google_connections
      ADD COLUMN scope TEXT;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE google_connections
      DROP COLUMN IF EXISTS scope;
  `);
};
