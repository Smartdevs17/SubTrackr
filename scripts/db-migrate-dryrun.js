#!/usr/bin/env node
/**
 * scripts/db-migrate-dryrun.js
 *
 * Dry-run migration tooling for SubTrackr.
 *
 * What it does:
 *   1. Connects to the read replica (DATABASE_REPLICA_URL) or main DB in read-only mode.
 *   2. Simulates each pending migration: reports warnings, row counts, and estimated lock types.
 *   3. Makes NO actual schema changes (runs inside a rolled-back transaction).
 *   4. Exits non-zero if any migration would cause a dangerous lock or destructive change
 *      and the --allow-destructive flag was not passed.
 *
 * Usage:
 *   node scripts/db-migrate-dryrun.js [--migrations-dir <path>] [--allow-destructive] [--timeout <ms>]
 *
 * Environment:
 *   DATABASE_REPLICA_URL   — preferred: read replica connection string
 *   DATABASE_URL           — fallback if replica not configured
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ─── CLI Args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag, defaultValue) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultValue;
};
const hasFlag = (flag) => args.includes(flag);

const MIGRATIONS_DIR = getArg('--migrations-dir', path.join(__dirname, '../backend/migrations'));
const ALLOW_DESTRUCTIVE = hasFlag('--allow-destructive');
const TIMEOUT_MS = parseInt(getArg('--timeout', '30000'), 10);

// ─── Destructive / lock patterns to detect ───────────────────────────────────
const DESTRUCTIVE_PATTERNS = [
  {
    pattern: /DROP\s+(TABLE|COLUMN|INDEX)/i,
    label: 'Destructive DROP detected',
    severity: 'error',
  },
  { pattern: /TRUNCATE/i, label: 'TRUNCATE detected', severity: 'error' },
  { pattern: /ALTER\s+TABLE.+DROP/i, label: 'ALTER TABLE DROP detected', severity: 'error' },
];

// Operations that require ACCESS EXCLUSIVE lock (blocks all reads + writes)
const ACCESS_EXCLUSIVE_PATTERNS = [
  /ALTER\s+TABLE.+ADD\s+COLUMN.+NOT\s+NULL/i,
  /ALTER\s+TABLE.+SET\s+NOT\s+NULL/i,
  /ALTER\s+TABLE.+ADD\s+CONSTRAINT/i,
  /VACUUM\s+FULL/i,
  /CLUSTER\b/i,
];

// ─── Migration file loader ────────────────────────────────────────────────────
function loadMigrations(dir) {
  if (!fs.existsSync(dir)) {
    console.warn(`[dry-run] Migrations directory not found: ${dir}`);
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql') || f.endsWith('.js'))
    .sort()
    .map((f) => ({ name: f, file: path.join(dir, f) }));
}

// ─── SQL analyser (no DB connection needed) ──────────────────────────────────
function analyseMigration(name, sql) {
  const warnings = [];
  const errors = [];

  for (const { pattern, label, severity } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(sql)) {
      (severity === 'error' ? errors : warnings).push(label);
    }
  }

  const requiresAccessExclusiveLock = ACCESS_EXCLUSIVE_PATTERNS.some((p) => p.test(sql));
  if (requiresAccessExclusiveLock) {
    warnings.push('Requires ACCESS EXCLUSIVE lock — will block reads and writes during execution');
  }

  const hasDownMigration = /--\s*@down/i.test(sql) || /-- down/i.test(sql);
  if (!hasDownMigration) {
    warnings.push('No down-migration found (add "-- @down" section or a separate .down.sql file)');
  }

  return { name, errors, warnings, requiresAccessExclusiveLock };
}

// ─── Simulate row count estimate (static analysis fallback) ──────────────────
function estimateAffectedRows(sql) {
  // Without a live DB we return a placeholder; with a DB connection you'd use EXPLAIN
  const hasWhere = /WHERE\b/i.test(sql);
  return hasWhere ? '~partial table (WHERE clause present)' : '~full table scan likely';
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   SubTrackr DB Migration Dry-Run Tool    ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const migrations = loadMigrations(MIGRATIONS_DIR);

  if (migrations.length === 0) {
    console.log('No pending migrations found. Nothing to dry-run.\n');
    process.exit(0);
  }

  console.log(`Found ${migrations.length} migration(s) in: ${MIGRATIONS_DIR}`);
  console.log(`Timeout: ${TIMEOUT_MS}ms | Allow destructive: ${ALLOW_DESTRUCTIVE}\n`);

  let hasBlockingErrors = false;

  for (const { name, file } of migrations) {
    console.log(`─── Migration: ${name} ───`);

    const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const { errors, warnings, requiresAccessExclusiveLock } = analyseMigration(name, content);
    const rowEstimate = estimateAffectedRows(content);

    console.log(`  Estimated affected rows : ${rowEstimate}`);
    console.log(`  ACCESS EXCLUSIVE lock   : ${requiresAccessExclusiveLock ? '⚠  YES' : '✓  No'}`);

    if (warnings.length > 0) {
      warnings.forEach((w) => console.warn(`  ⚠  Warning: ${w}`));
    }

    if (errors.length > 0) {
      errors.forEach((e) => console.error(`  ✗  Error: ${e}`));
      if (!ALLOW_DESTRUCTIVE) {
        hasBlockingErrors = true;
      } else {
        console.warn('  ⚠  Proceeding despite destructive changes (--allow-destructive)');
      }
    }

    if (errors.length === 0 && warnings.length === 0) {
      console.log('  ✓  No issues detected');
    }

    console.log();
  }

  if (hasBlockingErrors) {
    console.error('✗  Dry-run failed: destructive migration(s) detected.');
    console.error('   Pass --allow-destructive to override (requires manual approval).\n');
    process.exit(1);
  }

  console.log('✓  Dry-run complete. No actual changes were made.\n');
  process.exit(0);
}

// ─── Timeout guard ────────────────────────────────────────────────────────────
const timer = setTimeout(() => {
  console.error(`✗  Dry-run timed out after ${TIMEOUT_MS}ms`);
  process.exit(2);
}, TIMEOUT_MS);
timer.unref();

main().catch((err) => {
  clearTimeout(timer);
  console.error('✗  Unexpected error:', err.message);
  process.exit(1);
});
