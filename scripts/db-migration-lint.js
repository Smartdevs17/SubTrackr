#!/usr/bin/env node
/**
 * scripts/db-migration-lint.js
 *
 * Migration linter for SubTrackr.
 * Detects common issues:
 *   - Missing down migration
 *   - Destructive changes without explicit approval flag
 *   - ACCESS EXCLUSIVE lock risk
 *   - Migrations without a timeout hint
 *
 * Usage:
 *   node scripts/db-migration-lint.js [--migrations-dir <path>] [--strict]
 *
 * Exit codes: 0 = pass, 1 = lint errors found
 */

'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const hasFlag = (f) => args.includes(f);

const MIGRATIONS_DIR = getArg('--migrations-dir', path.join(__dirname, '../backend/migrations'));
const STRICT = hasFlag('--strict');
// Default timeout: 30 s as per acceptance criteria
const DEFAULT_TIMEOUT_HINT = "SET lock_timeout = '30s'";

const RULES = [
  {
    id: 'no-down-migration',
    message: 'Missing down migration. Add a "-- @down" section or a paired .down.sql file.',
    severity: 'error',
    check: (sql, name, dir) => {
      const hasInlineDown = /--\s*@down/i.test(sql) || /-- down/i.test(sql);
      const downFile = path.join(dir, name.replace(/\.sql$/, '.down.sql'));
      return !hasInlineDown && !fs.existsSync(downFile);
    },
  },
  {
    id: 'destructive-without-flag',
    message: 'Destructive change (DROP/TRUNCATE) without "@allow-destructive" flag.',
    severity: 'error',
    check: (sql) => {
      const isDestructive = /DROP\s+(TABLE|COLUMN)|TRUNCATE/i.test(sql);
      const hasFlag = /@allow-destructive/i.test(sql);
      return isDestructive && !hasFlag;
    },
  },
  {
    id: 'access-exclusive-lock',
    message:
      'Statement may acquire ACCESS EXCLUSIVE lock. Consider online migration pattern (expand-migrate-contract).',
    severity: 'warn',
    check: (sql) =>
      /ALTER\s+TABLE.+ADD\s+COLUMN.+NOT\s+NULL(?!\s+DEFAULT)/i.test(sql) ||
      /ALTER\s+TABLE.+SET\s+NOT\s+NULL/i.test(sql) ||
      /ALTER\s+TABLE.+ADD\s+CONSTRAINT(?!\s+VALID)/i.test(sql),
  },
  {
    id: 'missing-lock-timeout',
    message: `Missing lock_timeout setting. Add "${DEFAULT_TIMEOUT_HINT}" at the top of the migration.`,
    severity: 'warn',
    check: (sql) => {
      const hasAlter = /ALTER\s+TABLE/i.test(sql);
      const hasTimeout = /lock_timeout/i.test(sql);
      return hasAlter && !hasTimeout;
    },
  },
  {
    id: 'not-null-without-default',
    message: 'Adding NOT NULL column without DEFAULT may fail on non-empty tables.',
    severity: 'error',
    check: (sql) => /ADD\s+COLUMN\s+\w+\s+\w+\s+NOT\s+NULL(?!\s+DEFAULT)/i.test(sql),
  },
];

function lintFile(name, filePath, dir) {
  const sql = fs.readFileSync(filePath, 'utf8');
  const issues = [];

  for (const rule of RULES) {
    if (rule.check(sql, name, dir)) {
      issues.push({ rule: rule.id, severity: rule.severity, message: rule.message });
    }
  }

  return issues;
}

function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║      SubTrackr Migration Linter          ║');
  console.log('╚══════════════════════════════════════════╝\n');

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.warn(`Migrations directory not found: ${MIGRATIONS_DIR}\n`);
    process.exit(0);
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No migration files found. Nothing to lint.\n');
    process.exit(0);
  }

  console.log(`Linting ${files.length} migration(s)...\n`);

  let errorCount = 0;
  let warnCount = 0;

  for (const f of files) {
    const issues = lintFile(f, path.join(MIGRATIONS_DIR, f), MIGRATIONS_DIR);
    if (issues.length === 0) {
      console.log(`  ✓  ${f}`);
      continue;
    }

    console.log(`  ✗  ${f}`);
    for (const issue of issues) {
      const icon = issue.severity === 'error' ? '    ✗ ' : '    ⚠ ';
      console.log(`${icon}[${issue.rule}] ${issue.message}`);
      if (issue.severity === 'error') errorCount++;
      else warnCount++;
    }
  }

  console.log(`\nSummary: ${errorCount} error(s), ${warnCount} warning(s)\n`);

  if (errorCount > 0 || (STRICT && warnCount > 0)) {
    console.error('✗  Migration lint failed.\n');
    process.exit(1);
  }

  console.log('✓  Migration lint passed.\n');
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error('Unexpected error:', err.message);
  process.exit(2);
}
