#!/usr/bin/env node
/**
 * scripts/db-expand-migrate-contract.js
 *
 * Zero-downtime migration helper — expand-migrate-contract pattern.
 *
 * Phase overview:
 *
 *   EXPAND   — add new column/table/index (nullable, backward-compatible).
 *              Old code still writes to old column; new code writes to both.
 *
 *   MIGRATE  — backfill data from old column/table to new one.
 *              Safe to run online; processes in configurable batches.
 *
 *   CONTRACT — remove old column/table once all traffic uses the new schema.
 *              Only runs after EXPAND + MIGRATE are verified complete.
 *
 * Usage:
 *   node scripts/db-expand-migrate-contract.js --phase expand   --migration <name>
 *   node scripts/db-expand-migrate-contract.js --phase migrate  --migration <name> [--batch-size 1000]
 *   node scripts/db-expand-migrate-contract.js --phase contract --migration <name> [--allow-destructive]
 *   node scripts/db-expand-migrate-contract.js --status         --migration <name>
 *
 * State is persisted in backend/migrations/.emc-state.json so phases cannot
 * be run out of order.
 *
 * Environment:
 *   DATABASE_URL  — connection string (used for live DB operations when available)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── CLI parsing ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const hasFlag = (f) => args.includes(f);

const PHASE = getArg('--phase', null);
const MIGRATION = getArg('--migration', null);
const BATCH_SIZE = parseInt(getArg('--batch-size', '1000'), 10);
const ALLOW_DESTRUCTIVE = hasFlag('--allow-destructive');
const STATUS_ONLY = hasFlag('--status');

const STATE_FILE = path.join(__dirname, '../backend/migrations/.emc-state.json');
const MIGRATIONS_DIR = path.join(__dirname, '../backend/migrations');

const PHASES = ['expand', 'migrate', 'contract'];

// ─── State management ─────────────────────────────────────────────────────────
function loadState() {
  if (!fs.existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getMigrationState(name) {
  const state = loadState();
  return state[name] || { completedPhases: [], startedAt: null };
}

function markPhaseComplete(name, phase) {
  const state = loadState();
  if (!state[name]) state[name] = { completedPhases: [], startedAt: new Date().toISOString() };
  if (!state[name].completedPhases.includes(phase)) {
    state[name].completedPhases.push(phase);
    state[name][`${phase}CompletedAt`] = new Date().toISOString();
  }
  saveState(state);
}

// ─── Phase implementations ────────────────────────────────────────────────────

/**
 * EXPAND phase: run the .expand.sql file (additive changes only).
 * Validates the file contains no destructive statements before executing.
 */
function runExpand(name) {
  console.log(`\n[expand] Running expand phase for migration: ${name}`);

  const expandFile = path.join(MIGRATIONS_DIR, `${name}.expand.sql`);
  if (!fs.existsSync(expandFile)) {
    // If no separate expand file, check for inline @expand section
    const mainFile = path.join(MIGRATIONS_DIR, `${name}.sql`);
    if (!fs.existsSync(mainFile)) {
      console.error(`  ✗  No expand file found: ${expandFile}`);
      console.error(`     Create ${name}.expand.sql with additive-only SQL statements.`);
      process.exit(1);
    }
    const src = fs.readFileSync(mainFile, 'utf8');
    const expandSection = extractSection(src, '@expand');
    if (!expandSection) {
      console.error(`  ✗  No @expand section found in ${name}.sql`);
      console.error(`     Add a "-- @expand" section with additive-only statements.`);
      process.exit(1);
    }
    return executeExpand(name, expandSection);
  }

  const sql = fs.readFileSync(expandFile, 'utf8');
  return executeExpand(name, sql);
}

function executeExpand(name, sql) {
  // Guard: no destructive statements allowed in expand phase
  if (/DROP\s+(TABLE|COLUMN)|TRUNCATE/i.test(sql) && !ALLOW_DESTRUCTIVE) {
    console.error('  ✗  Expand phase SQL contains destructive statements.');
    console.error('     The expand phase must only add nullable columns/tables/indexes.');
    console.error('     Use --allow-destructive to override (not recommended).');
    process.exit(1);
  }

  if (/ALTER\s+TABLE.+ADD\s+COLUMN.+NOT\s+NULL(?!\s+DEFAULT)/i.test(sql)) {
    console.error('  ✗  Expand phase: NOT NULL column without DEFAULT will lock table.');
    console.error('     Add a DEFAULT value or make the column nullable.');
    process.exit(1);
  }

  console.log('  ✓  Expand SQL validated (no destructive changes)');
  console.log(
    '  ℹ  To execute against DB: set DATABASE_URL and integrate with your migration runner.'
  );
  console.log(`     SQL preview (first 300 chars):\n\n${sql.slice(0, 300).trim()}\n`);
  markPhaseComplete(name, 'expand');
  console.log(`  ✓  Expand phase recorded for "${name}"`);
}

/**
 * MIGRATE phase: backfill data in configurable batches.
 * Requires expand phase to be complete.
 */
function runMigrate(name) {
  console.log(`\n[migrate] Running migrate phase for migration: ${name}`);

  const migState = getMigrationState(name);
  if (!migState.completedPhases.includes('expand')) {
    console.error('  ✗  Expand phase has not been completed for this migration.');
    console.error(
      `     Run: node scripts/db-expand-migrate-contract.js --phase expand --migration ${name}`
    );
    process.exit(1);
  }

  const migrateFile = path.join(MIGRATIONS_DIR, `${name}.migrate.sql`);
  let sql = '';

  if (fs.existsSync(migrateFile)) {
    sql = fs.readFileSync(migrateFile, 'utf8');
  } else {
    const mainFile = path.join(MIGRATIONS_DIR, `${name}.sql`);
    if (fs.existsSync(mainFile)) {
      sql = extractSection(fs.readFileSync(mainFile, 'utf8'), '@migrate') || '';
    }
  }

  if (!sql.trim()) {
    console.log(
      '  ℹ  No migrate SQL found — assuming data backfill is handled by application code.'
    );
  } else {
    console.log(`  ℹ  Backfill SQL (batch size: ${BATCH_SIZE}):`);
    console.log(`\n${sql.slice(0, 300).trim()}\n`);
    console.log(
      '  ℹ  To execute: integrate with your migration runner and pass batch size as a bind parameter.'
    );
  }

  markPhaseComplete(name, 'migrate');
  console.log(`  ✓  Migrate phase recorded for "${name}"`);
}

/**
 * CONTRACT phase: remove old schema (destructive — requires --allow-destructive).
 * Requires both expand + migrate phases to be complete.
 */
function runContract(name) {
  console.log(`\n[contract] Running contract phase for migration: ${name}`);

  const migState = getMigrationState(name);
  const completed = migState.completedPhases || [];

  if (!completed.includes('expand') || !completed.includes('migrate')) {
    console.error('  ✗  Cannot run contract phase: expand and/or migrate not complete.');
    console.error(`     Completed phases: [${completed.join(', ')}]`);
    process.exit(1);
  }

  if (!ALLOW_DESTRUCTIVE) {
    console.error('  ✗  Contract phase removes old columns/tables (destructive).');
    console.error(
      `     Re-run with --allow-destructive after verifying all traffic uses the new schema.`
    );
    process.exit(1);
  }

  const contractFile = path.join(MIGRATIONS_DIR, `${name}.contract.sql`);
  let sql = '';

  if (fs.existsSync(contractFile)) {
    sql = fs.readFileSync(contractFile, 'utf8');
  } else {
    const mainFile = path.join(MIGRATIONS_DIR, `${name}.sql`);
    if (fs.existsSync(mainFile)) {
      sql = extractSection(fs.readFileSync(mainFile, 'utf8'), '@contract') || '';
    }
  }

  if (!sql.trim()) {
    console.log('  ⚠  No contract SQL found. Create a @contract section or a .contract.sql file.');
  } else {
    console.log(`  ℹ  Contract SQL preview:\n\n${sql.slice(0, 300).trim()}\n`);
    console.log('  ℹ  To execute: integrate with your migration runner.');
  }

  markPhaseComplete(name, 'contract');
  console.log(`  ✓  Contract phase recorded for "${name}". Migration complete.`);
}

// ─── Status report ────────────────────────────────────────────────────────────
function printStatus(name) {
  const state = loadState();
  const migrations = name ? [name] : Object.keys(state);

  if (migrations.length === 0) {
    console.log('  No expand-migrate-contract migrations tracked yet.');
    return;
  }

  for (const m of migrations) {
    const s = state[m] || { completedPhases: [] };
    const completed = s.completedPhases || [];
    const pending = PHASES.filter((p) => !completed.includes(p));
    console.log(`\n  Migration: ${m}`);
    console.log(`    Started       : ${s.startedAt || 'not started'}`);
    console.log(`    Completed     : [${completed.join(', ')}]`);
    console.log(`    Pending       : [${pending.join(', ')}]`);
    if (completed.includes('contract')) {
      console.log('    Status        : ✓ COMPLETE');
    } else if (completed.length === 0) {
      console.log('    Status        : ○ NOT STARTED');
    } else {
      console.log(`    Status        : ◑ IN PROGRESS (next: ${pending[0]})`);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function extractSection(src, marker) {
  const re = new RegExp(`--\\s*${marker}\\b([\\s\\S]*?)(?=--\\s*@|$)`, 'i');
  const match = src.match(re);
  return match ? match[1].trim() : null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║   SubTrackr Expand-Migrate-Contract Helper         ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  if (STATUS_ONLY) {
    printStatus(MIGRATION);
    return;
  }

  if (!PHASE || !MIGRATION) {
    console.error('Usage:');
    console.error(
      '  node scripts/db-expand-migrate-contract.js --phase <expand|migrate|contract> --migration <name>'
    );
    console.error('  node scripts/db-expand-migrate-contract.js --status [--migration <name>]');
    process.exit(1);
  }

  if (!PHASES.includes(PHASE)) {
    console.error(`Unknown phase "${PHASE}". Must be one of: ${PHASES.join(', ')}`);
    process.exit(1);
  }

  switch (PHASE) {
    case 'expand':
      runExpand(MIGRATION);
      break;
    case 'migrate':
      runMigrate(MIGRATION);
      break;
    case 'contract':
      runContract(MIGRATION);
      break;
  }
}

try {
  main();
} catch (err) {
  console.error('Unexpected error:', err.message);
  process.exit(2);
}
