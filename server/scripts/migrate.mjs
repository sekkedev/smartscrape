#!/usr/bin/env node
// Plain-JS migration runner. Deliberately dependency-light: the production
// Docker image installs with `--omit=dev`, so this script must run on nothing
// but node + production deps (node-pg-migrate, dotenv). The previous TS
// version needed tsx (a devDependency) and imported src/config/env.ts (not
// shipped in the runtime image), which made the container crash-loop at boot.
import dotenv from 'dotenv';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { runner } from 'node-pg-migrate';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the nearest .env walking up from this script, mirroring
// src/config/env.ts. `npm run --workspace server` sets cwd to server/, so a
// bare `import 'dotenv/config'` would miss the repo-root .env the README
// tells devs to create. Real env vars (Docker/CI) always win: dotenv never
// overrides variables that are already set.
for (let dir = __dirname; ; ) {
  const candidate = join(dir, '.env');
  if (existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

const migrationsDir = resolve(__dirname, '..', 'migrations');

if (!existsSync(migrationsDir)) {
  mkdirSync(migrationsDir, { recursive: true });
}

const [rawCommand, rawArg] = process.argv.slice(2);
const command = rawCommand ?? 'up';

function usage() {
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
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const file = resolve(migrationsDir, `${stamp}_${slug}.js`);
  writeFileSync(
    file,
    `/** @type {import('node-pg-migrate').MigrationBuilder} */\n\nexport const up = (pgm) => {\n  pgm.sql(\`\n    -- write SQL here\n  \`);\n};\n\nexport const down = (pgm) => {\n  pgm.sql(\`\n    -- reverse SQL here\n  \`);\n};\n`,
  );
  console.log(`created ${file}`);
  process.exit(0);
}

if (!['up', 'down', 'redo'].includes(command)) usage();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const base = {
  databaseUrl,
  dir: migrationsDir,
  migrationsTable: 'pgmigrations',
  verbose: true,
  singleTransaction: true,
};

try {
  if (command === 'redo') {
    await runner({ ...base, direction: 'down', count: 1 });
    await runner({ ...base, direction: 'up', count: 1 });
  } else {
    await runner({ ...base, direction: command, count: command === 'down' ? 1 : Infinity });
  }
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
