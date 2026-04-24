#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { runner } from 'node-pg-migrate';
import { env } from '../src/config/env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, '..', 'migrations');

if (!existsSync(migrationsDir)) {
  mkdirSync(migrationsDir, { recursive: true });
}

type Direction = 'up' | 'down' | 'redo';

const [rawCommand, rawArg] = process.argv.slice(2);
const command = rawCommand ?? 'up';

function usage(): never {
  console.error('usage: migrate <up|down|redo|create> [name]');
  process.exit(1);
}

if (command === 'create') {
  const name = rawArg;
  if (!name) usage();
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const file = resolve(migrationsDir, `${stamp}_${slug}.js`);
  writeFileSync(
    file,
    `/** @type {import('node-pg-migrate').MigrationBuilder} */\n\nexport const up = (pgm) => {\n  pgm.sql(\`\n    -- write SQL here\n  \`);\n};\n\nexport const down = (pgm) => {\n  pgm.sql(\`\n    -- reverse SQL here\n  \`);\n};\n`,
  );
  console.log(`created ${file}`);
  process.exit(0);
}

if (!['up', 'down', 'redo'].includes(command)) usage();

if (!env.databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const direction = command as Direction;

try {
  if (direction === 'redo') {
    await runner({
      databaseUrl: env.databaseUrl,
      dir: migrationsDir,
      migrationsTable: 'pgmigrations',
      direction: 'down',
      count: 1,
      verbose: true,
      singleTransaction: true,
    });
    await runner({
      databaseUrl: env.databaseUrl,
      dir: migrationsDir,
      migrationsTable: 'pgmigrations',
      direction: 'up',
      count: 1,
      verbose: true,
      singleTransaction: true,
    });
  } else {
    await runner({
      databaseUrl: env.databaseUrl,
      dir: migrationsDir,
      migrationsTable: 'pgmigrations',
      direction,
      count: direction === 'down' ? 1 : Infinity,
      verbose: true,
      singleTransaction: true,
    });
  }
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
