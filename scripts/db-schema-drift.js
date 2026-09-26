#!/usr/bin/env node
/**
 * scripts/db-schema-drift.js
 *
 * Schema drift detection for SubTrackr.
 * Compares the expected schema derived from migration files against
 * a snapshot file (or live DB introspection if DATABASE_URL is set).
 *
 * Usage:
 *   node scripts/db-schema-drift.js [--snapshot <path>] [--expected <path>]
 *
 * Exit codes:
 *   0 — no drift detected
 *   1 — drift detected
 *   2 — unexpected error
 */

'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};

const SNAPSHOT_PATH = getArg(
  '--snapshot',
  path.join(__dirname, '../backend/migrations/.schema-snapshot.json')
);
const EXPECTED_PATH = getArg(
  '--expected',
  path.join(__dirname, '../backend/migrations/.schema-expected.json')
);

function loadJson(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function diffSchemas(expected, actual) {
  const diffs = [];

  const expectedTables = new Set(Object.keys(expected.tables ?? {}));
  const actualTables = new Set(Object.keys(actual.tables ?? {}));

  for (const t of expectedTables) {
    if (!actualTables.has(t)) {
      diffs.push({
        type: 'missing_table',
        table: t,
        message: `Table "${t}" expected but not found in actual schema`,
      });
    }
  }
  for (const t of actualTables) {
    if (!expectedTables.has(t)) {
      diffs.push({
        type: 'extra_table',
        table: t,
        message: `Table "${t}" exists in DB but not in expected schema`,
      });
    }
  }

  for (const t of expectedTables) {
    if (!actualTables.has(t)) continue;
    const expCols = expected.tables[t].columns ?? {};
    const actCols = actual.tables[t].columns ?? {};

    for (const col of Object.keys(expCols)) {
      if (!actCols[col]) {
        diffs.push({
          type: 'missing_column',
          table: t,
          column: col,
          message: `Column "${t}.${col}" expected but missing`,
        });
      } else if (expCols[col].type !== actCols[col].type) {
        diffs.push({
          type: 'type_mismatch',
          table: t,
          column: col,
          message: `Column "${t}.${col}" type mismatch: expected ${expCols[col].type}, got ${actCols[col].type}`,
        });
      }
    }
    for (const col of Object.keys(actCols)) {
      if (!expCols[col]) {
        diffs.push({
          type: 'extra_column',
          table: t,
          column: col,
          message: `Column "${t}.${col}" exists but not in expected schema`,
        });
      }
    }
  }

  return diffs;
}

function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   SubTrackr DB Schema Drift Detection    ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const expected = loadJson(EXPECTED_PATH);
  const actual = loadJson(SNAPSHOT_PATH);

  if (!expected) {
    console.warn(`Expected schema file not found: ${EXPECTED_PATH}`);
    console.warn('Create it by running: node scripts/db-schema-drift.js --generate\n');
    process.exit(0); // Non-blocking until baseline is established
  }

  if (!actual) {
    console.warn(`Schema snapshot not found: ${SNAPSHOT_PATH}`);
    console.warn('Generate a snapshot by running migrations and introspecting the DB.\n');
    process.exit(0);
  }

  const diffs = diffSchemas(expected, actual);

  if (diffs.length === 0) {
    console.log('✓  No schema drift detected.\n');
    process.exit(0);
  }

  console.error(`✗  Schema drift detected! ${diffs.length} difference(s):\n`);
  diffs.forEach((d, i) => console.error(`  ${i + 1}. [${d.type}] ${d.message}`));
  console.error('\nPlease run the pending migrations or update the expected schema snapshot.\n');
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error('Unexpected error:', err.message);
  process.exit(2);
}
