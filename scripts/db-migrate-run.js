#!/usr/bin/env node
/**
 * scripts/db-migrate-run.js
 *
 * Issue #1288 — Build schema migration dry-run tool.
 *
 * Companion to scripts/db-migrate-dryrun.js. The dry-run tool analyses
 * migrations without touching a database; this tool actually applies them.
 *
 * Design:
 *   - Drives `psql`, which is already a hard requirement of the documented
 *     migration workflow (`psql $DATABASE_URL -f <file>.sql`). No npm
 *     dependency is introduced, so the tool works in a bare CI runner.
 *   - Keeps a `schema_migrations` ledger so `up` is idempotent and `down`
 *     rolls back exactly one step (or everything, with --all).
 *   - Each migration runs in its own transaction, so a failure leaves the
 *     ledger consistent with the database.
 *   - A migration is only marked applied when its down section (or paired
 *     .down.sql file) exists, which is what makes rollback parity enforceable
 *     rather than aspirational.
 *
 * Usage:
 *   node scripts/db-migrate-run.js up    [--migrations-dir <path>] [--dry-run]
 *   node scripts/db-migrate-run.js down  [--steps <n>] [--all]
 *   node scripts/db-migrate-run.js status
 *
 * Environment:
 *   DATABASE_URL  — required. Falls back to DATABASE_REPLICA_URL is *not*
 *                   supported: migrations must never run against a replica.
 *
 * Exit codes: 0 = success, 1 = migration failure, 2 = usage/environment error
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, '../backend/migrations');

const LEDGER_TABLE = 'schema_migrations';

/** DDL for the migration ledger. */
const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checksum    TEXT
)`;

// ─── Small helpers (shared with the tests) ──────────────────────────────────

/** Parse argv into an options object. */
function parseArgs(argv) {
  const options = {
    command: null,
    migrationsDir: DEFAULT_MIGRATIONS_DIR,
    steps: 1,
    all: false,
    dryRun: false,
  };

  const commandIndex = argv.length > 0 && !argv[0].startsWith('-') ? 0 : -1;
  if (commandIndex >= 0) options.command = argv[0];

  for (let i = 0; i < argv.length; i += 1) {
    if (i === commandIndex) continue;
    const arg = argv[i];
    if (arg === '--migrations-dir') {
      options.migrationsDir = path.resolve(argv[i + 1] || DEFAULT_MIGRATIONS_DIR);
      i += 1;
    } else if (arg === '--steps') {
      options.steps = Math.max(1, Number.parseInt(argv[i + 1] || '1', 10) || 1);
      i += 1;
    } else if (arg === '--all') options.all = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

/** Parse a `NNN_name.sql` filename into its version and slug. */
function parseMigrationName(file) {
  const match = /^(\d+)[_-](.+)\.sql$/.exec(file);
  if (!match) return null;
  return { version: match[1], slug: match[2] };
}

/** Stable content hash used to detect an edited, already-applied migration. */
function checksum(sql) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < sql.length; i += 1) {
    hash ^= sql.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Split a migration into its up and down sections. */
function splitSections(sql) {
  const lines = sql.split('\n');
  const up = [];
  const down = [];
  let inDown = false;
  for (const line of lines) {
    if (/^\s*--\s*(@down|down)\b/i.test(line)) {
      inDown = true;
      down.push(line);
      continue;
    }
    (inDown ? down : up).push(line);
  }
  return { up: up.join('\n').trim(), down: down.join('\n').trim() };
}

/** Read every migration in a directory, sorted by version. */
function loadMigrations(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.sql') && !file.endsWith('.down.sql'))
    .sort()
    .map((file) => {
      const parsed = parseMigrationName(file);
      if (!parsed) return null;
      const full = path.join(dir, file);
      const sql = fs.readFileSync(full, 'utf8');
      const sections = splitSections(sql);
      const downFile = path.join(dir, file.replace(/\.sql$/, '.down.sql'));
      const paired = fs.existsSync(downFile) ? fs.readFileSync(downFile, 'utf8').trim() : '';
      return {
        file,
        version: parsed.version,
        slug: parsed.slug,
        up: sections.up,
        down: sections.down || paired,
        checksum: checksum(sections.up),
      };
    })
    .filter(Boolean);
}

// ─── Database access ────────────────────────────────────────────────────────

/** Run a psql invocation, returning { ok, stdout, stderr }. */
function psql(databaseUrl, sql, extraArgs) {
  const args = ['-v', 'ON_ERROR_STOP=1', '--no-psqlrc', '-tAq'];
  for (const arg of extraArgs || []) args.push(arg);
  args.push(databaseUrl);
  args.push(sql);

  const result = spawnSync('psql', args, { encoding: 'utf8' });
  if (result.error) {
    return { ok: false, stdout: '', stderr: result.error.message, spawnFailed: true };
  }
  return { ok: result.status === 0, stdout: result.stdout || '', stderr: result.stderr || '' };
}

/** True when a usable psql binary is on PATH. */
function psqlAvailable() {
  const probe = spawnSync('psql', ['--version'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

/** Ensure the ledger table exists and return the set of applied versions. */
function readLedger(databaseUrl) {
  const created = psql(databaseUrl, LEDGER_DDL);
  if (!created.ok) {
    throw new Error(`Cannot create ${LEDGER_TABLE}: ${created.stderr.trim()}`);
  }
  const rows = psql(databaseUrl, `SELECT version FROM ${LEDGER_TABLE} ORDER BY version`);
  if (!rows.ok) {
    throw new Error(`Cannot read ${LEDGER_TABLE}: ${rows.stderr.trim()}`);
  }
  return new Set(
    rows.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  );
}

/** Wrap a statement batch in a transaction so a failure is all-or-nothing. */
function transactional(body) {
  return `BEGIN;\n${body}\nCOMMIT;`;
}

// ─── Commands ───────────────────────────────────────────────────────────────

/** Apply every migration that is not yet in the ledger. */
function migrateUp(options, databaseUrl) {
  const applied = readLedger(databaseUrl);
  const pending = loadMigrations(options.migrationsDir).filter((m) => !applied.has(m.version));

  if (pending.length === 0) {
    console.log(`[migrate] Nothing to apply — ${applied.size} migration(s) already recorded.`);
    return 0;
  }

  console.log(`[migrate] Applying ${pending.length} migration(s)…`);
  let count = 0;

  for (const migration of pending) {
    if (migration.down === '') {
      console.warn(
        `[migrate] ⚠  ${migration.file} has no rollback path — it will be applied but ` +
          'cannot be undone by `migrate down`.'
      );
    }
    if (options.dryRun) {
      console.log(`[migrate] (dry-run) would apply ${migration.file}`);
      count += 1;
      continue;
    }

    const statement = transactional(
      `${migration.up}\n` +
        `INSERT INTO ${LEDGER_TABLE} (version, checksum) ` +
        `VALUES ('${migration.version}', '${migration.checksum}') ` +
        'ON CONFLICT (version) DO NOTHING;'
    );
    const result = psql(databaseUrl, statement);
    if (!result.ok) {
      console.error(`[migrate] ✗  ${migration.file} failed:\n${result.stderr.trim()}`);
      console.error(`[migrate] ${count} migration(s) applied before the failure.`);
      return 1;
    }
    console.log(`[migrate] ✓  ${migration.file}`);
    count += 1;
  }

  console.log(`[migrate] ${count} migration(s) applied.`);
  return 0;
}

/** Roll back the most recent migrations. */
function migrateDown(options, databaseUrl) {
  const applied = readLedger(databaseUrl);
  const byVersion = new Map(
    loadMigrations(options.migrationsDir).map((migration) => [migration.version, migration])
  );

  const ordered = [...applied].sort((a, b) => b.localeCompare(a));
  const reversible = [];
  const irreversible = [];
  for (const version of ordered) {
    const migration = byVersion.get(version);
    if (!migration) continue;
    if (migration.down === '') irreversible.push(version);
    else reversible.push(version);
  }

  if (irreversible.length > 0) {
    // Do not silently skip: `down --all` that quietly leaves rows behind is
    // worse than one that says so.
    console.warn(
      `[migrate] ⚠  No down path for ${irreversible.length} applied migration(s): ` +
        `${irreversible.join(', ')}. Add an inline -- @down section or a <version>.down.sql file.`
    );
  }

  if (reversible.length === 0) {
    console.log('[migrate] Nothing to roll back — no reversible migrations recorded.');
    return 0;
  }

  const count = options.all ? reversible.length : Math.min(options.steps, reversible.length);
  console.log(`[migrate] Rolling back ${count} migration(s)…`);

  for (let i = 0; i < count; i += 1) {
    const version = reversible[i];
    const migration = byVersion.get(version);
    if (options.dryRun) {
      console.log(`[migrate] (dry-run) would roll back ${migration.file}`);
      continue;
    }

    const statement = transactional(
      `${migration.down}\nDELETE FROM ${LEDGER_TABLE} WHERE version = '${version}';`
    );
    const result = psql(databaseUrl, statement);
    if (!result.ok) {
      console.error(`[migrate] ✗  ${migration.file} rollback failed:\n${result.stderr.trim()}`);
      return 1;
    }
    console.log(`[migrate] ✓  rolled back ${migration.file}`);
  }

  return 0;
}

/** Print which migrations are applied and which are pending. */
function migrateStatus(options, databaseUrl) {
  const applied = readLedger(databaseUrl);
  const migrations = loadMigrations(options.migrationsDir);
  const rows = migrations.map(
    (migration) =>
      `  ${applied.has(migration.version) ? 'applied' : 'pending'}  ` +
      `${migration.file}${migration.down === '' ? '  (no rollback)' : ''}`
  );
  console.log(`[migrate] ${migrations.length} migration(s) in ${options.migrationsDir}`);
  for (const row of rows) console.log(row);
  return 0;
}

// ─── Entry point ────────────────────────────────────────────────────────────

function run(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    console.error(`[migrate] ${err.message}`);
    return 2;
  }

  if (options.help || !options.command) {
    console.log('Usage: node scripts/db-migrate-run.js up   [--migrations-dir <p>] [--dry-run]');
    console.log('       node scripts/db-migrate-run.js down [--steps <n> | --all]');
    console.log('       node scripts/db-migrate-run.js status');
    return options.help ? 0 : 2;
  }

  if (!['up', 'down', 'status'].includes(options.command)) {
    console.error(`[migrate] Unknown command "${options.command}". Use up, down or status.`);
    return 2;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[migrate] DATABASE_URL is not set. Refusing to run migrations.');
    return 2;
  }

  if (!psqlAvailable()) {
    console.error('[migrate] psql was not found on PATH. Install the PostgreSQL client tools.');
    return 2;
  }

  try {
    if (options.command === 'up') return migrateUp(options, databaseUrl);
    if (options.command === 'down') return migrateDown(options, databaseUrl);
    return migrateStatus(options, databaseUrl);
  } catch (err) {
    console.error('[migrate] ✗  ' + (err && err.message));
    return 1;
  }
}

if (require.main === module) {
  process.exit(run(process.argv.slice(2)));
}

module.exports = {
  DEFAULT_MIGRATIONS_DIR,
  LEDGER_DDL,
  LEDGER_TABLE,
  checksum,
  loadMigrations,
  parseArgs,
  parseMigrationName,
  run,
  splitSections,
};
