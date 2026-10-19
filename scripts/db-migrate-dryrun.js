#!/usr/bin/env node
/**
 * scripts/db-migrate-dryrun.js
 *
 * Issue #1288 — Build schema migration dry-run tool.
 *
 * What it does:
 *   1. Discovers migrations in a directory (default: backend/migrations).
 *   2. Splits each file into its up / down sections (`-- @down` marker or a
 *      paired `<name>.down.sql` file).
 *   3. Analyses the up section statement by statement and reports:
 *        - destructive changes (DROP / TRUNCATE)
 *        - statements that need an ACCESS EXCLUSIVE lock
 *        - NOT NULL columns added without a DEFAULT
 *        - ALTER statements with no lock_timeout guard
 *        - migrations with no rollback path
 *   4. Makes NO schema changes and never opens a database connection, so it is
 *      safe to run against production checkouts and inside CI.
 *   5. Exits non-zero when a finding at or above --fail-on is present and
 *      --allow-destructive was not passed.
 *
 * Usage:
 *   node scripts/db-migrate-dryrun.js [--migrations-dir <path>] [--json]
 *                                      [--allow-destructive] [--fail-on <error|warn|none>]
 *                                      [--timeout <ms>]
 *
 * Exit codes: 0 = pass, 1 = blocking findings, 2 = bad usage, 3 = unexpected error
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── CLI args ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const options = {
    migrationsDir: path.join(__dirname, '../backend/migrations'),
    allowDestructive: false,
    json: false,
    failOn: 'error',
    timeoutMs: 30_000,
  };

  const getArg = (flag, fallback) => {
    const index = argv.indexOf(flag);
    return index !== -1 && argv[index + 1] ? argv[index + 1] : fallback;
  };

  options.migrationsDir = path.resolve(getArg('--migrations-dir', options.migrationsDir));
  options.allowDestructive = argv.includes('--allow-destructive');
  options.json = argv.includes('--json');
  const failOn = getArg('--fail-on', 'error');
  if (!['error', 'warn', 'none'].includes(failOn)) {
    throw new Error(`--fail-on must be one of error, warn, none (received "${failOn}")`);
  }
  options.failOn = failOn;

  const rawTimeout = getArg('--timeout', getArg('--timeout-ms', '30000'));
  const timeout = Number.parseInt(rawTimeout, 10);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(`--timeout must be a positive number of milliseconds (got "${rawTimeout}")`);
  }
  options.timeoutMs = timeout;

  return options;
}

// ─── Rule tables ────────────────────────────────────────────────────────────

/** Destructive changes that destroy data. */
const DESTRUCTIVE_RULES = [
  { pattern: /\bDROP\s+TABLE\b/i, label: 'DROP TABLE', severity: 'error' },
  { pattern: /\bDROP\s+COLUMN\b/i, label: 'DROP COLUMN', severity: 'error' },
  {
    pattern: /\bDROP\s+(?:INDEX|TRIGGER|TYPE|DATABASE|SCHEMA)\b/i,
    label: 'DROP object',
    severity: 'warn',
  },
  { pattern: /\bTRUNCATE\b/i, label: 'TRUNCATE', severity: 'error' },
  { pattern: /\bDELETE\s+FROM\s+\w+\s*(?:;|$)/i, label: 'unbounded DELETE', severity: 'warn' },
];

/** Operations that take an ACCESS EXCLUSIVE lock, blocking all reads and writes. */
const ACCESS_EXCLUSIVE_RULES = [
  {
    pattern: /\bALTER\s+TABLE\b[\s\S]*?\bADD\s+COLUMN\b[\s\S]*?\bNOT\s+NULL\b/i,
    label: 'ADD COLUMN … NOT NULL',
  },
  { pattern: /\bALTER\s+TABLE\b[\s\S]*?\bSET\s+NOT\s+NULL\b/i, label: 'SET NOT NULL' },
  {
    pattern: /\bALTER\s+TABLE\b[\s\S]*?\bADD\s+CONSTRAINT\b/i,
    label: 'ADD CONSTRAINT (consider … NOT VALID)',
  },
  {
    pattern: /\bALTER\s+TABLE\b[\s\S]*?\bALTER\s+COLUMN\b[\s\S]*?\bTYPE\b/i,
    label: 'ALTER COLUMN TYPE',
  },
  { pattern: /\bVACUUM\s+FULL\b/i, label: 'VACUUM FULL' },
  { pattern: /\bCLUSTER\b/i, label: 'CLUSTER' },
  { pattern: /\bREINDEX\b/i, label: 'REINDEX' },
  {
    pattern: /\bCREATE\s+INDEX\b(?![^;]*\bCONCURRENTLY\b)/i,
    label: 'CREATE INDEX (use CONCURRENTLY)',
  },
];

/** Hint that keeps a migration from blocking on a contended lock. */
const LOCK_TIMEOUT_HINT = "SET lock_timeout = '30s'";

// ─── SQL parsing ────────────────────────────────────────────────────────────

/** Remove `--` line comments so they cannot influence the statement analysis. */
function stripComments(sql) {
  return sql
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('--')) return '';
      return line;
    })
    .join('\n');
}

/** True when a `-- @down` (or `-- down`) marker appears in the source. */
function hasDownMarker(sql) {
  return /^\s*--\s*@down\b/im.test(sql) || /^\s*--\s*down\b/im.test(sql);
}

/**
 * Split a migration into its up and down sections.
 * Everything from the first `-- @down` marker onwards is the rollback path and
 * is excluded from the forward analysis.
 */
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

  return { up: up.join('\n'), down: down.join('\n') };
}

/** Split SQL into individual statements, ignoring comments and empty fragments. */
function splitStatements(sql) {
  return stripComments(sql)
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

// ─── Migration loading ───────────────────────────────────────────────────────

/** Load migrations from a directory, pairing each file with its down section. */
function loadMigrations(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.sql') && !file.endsWith('.down.sql'))
    .sort()
    .map((file) => {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      const inline = splitSections(sql);
      const downFile = path.join(dir, file.replace(/\.sql$/, '.down.sql'));
      const paired = fs.existsSync(downFile) ? fs.readFileSync(downFile, 'utf8') : '';
      return {
        name: file,
        path: path.join(dir, file),
        up: inline.up,
        down: inline.down.trim() || paired,
        hasDown: inline.down.trim().length > 0 || paired.trim().length > 0,
      };
    });
}

// ─── Analysis ───────────────────────────────────────────────────────────────

/**
 * Analyse a single migration's forward section.
 * Pure: takes SQL text, returns findings. No I/O, no database.
 */
function analyseMigration(name, sql) {
  const { up } = splitSections(sql || '');
  const statements = splitStatements(up);
  const errors = [];
  const warnings = [];
  let destructive = false;

  for (const rule of DESTRUCTIVE_RULES) {
    if (!rule.pattern.test(up)) continue;
    if (rule.severity === 'error') {
      errors.push(rule.label);
      destructive = true;
    } else {
      warnings.push(rule.label);
    }
  }

  const accessExclusive = ACCESS_EXCLUSIVE_RULES.filter((rule) => rule.pattern.test(up));
  for (const rule of accessExclusive) {
    warnings.push(`Requires ACCESS EXCLUSIVE lock: ${rule.label}`);
  }

  if (/\bALTER\s+TABLE\b/i.test(up) && !/lock_timeout/i.test(up)) {
    warnings.push(`No lock_timeout guard — add "${LOCK_TIMEOUT_HINT}" to the top of the file`);
  }

  if (/\bADD\s+COLUMN\s+\w+\s+\w+\s+NOT\s+NULL\b/i.test(up) && !/\bDEFAULT\b/i.test(up)) {
    errors.push('ADD COLUMN … NOT NULL without DEFAULT will fail on a non-empty table');
  }

  if (/\bCREATE\s+(UNIQUE\s+)?INDEX\b(?![^;]*\bCONCURRENTLY\b)/i.test(up)) {
    warnings.push('Index created without CONCURRENTLY — takes a write lock on the table');
  }

  return {
    name,
    statements: statements.length,
    errors,
    warnings,
    requiresAccessExclusiveLock: accessExclusive.length > 0,
    destructive,
    hasDownMigration: hasDownMarker(sql || ''),
    rowEstimate: statements.some((statement) => /\bWHERE\b/i.test(statement))
      ? 'partial (WHERE clause present)'
      : 'full scan likely',
  };
}

/** Merge a per-migration report into a single, CI-friendly summary. */
function summarise(reports) {
  return {
    migrations: reports.length,
    errorCount: reports.reduce((sum, report) => sum + report.errors.length, 0),
    warnCount: reports.reduce((sum, report) => sum + report.warnings.length, 0),
    accessExclusiveCount: reports.filter((report) => report.requiresAccessExclusiveLock).length,
    missingRollback: reports.filter((report) => !report.hasDownMigration).map((r) => r.name),
  };
}

/** True when the run should fail for the configured --fail-on level. */
function shouldFail(summary, failOn) {
  if (failOn === 'none') return false;
  if (failOn === 'warn') return summary.errorCount > 0 || summary.warnCount > 0;
  return summary.errorCount > 0;
}

// ─── Output ─────────────────────────────────────────────────────────────────

function printJson(reports, summary) {
  process.stdout.write(JSON.stringify({ summary, migrations: reports }, null, 2) + '\n');
}

function printReport(reports, summary) {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   SubTrackr DB Migration Dry-Run Tool    ║');
  console.log('╚══════════════════════════════════════════╝\n');

  for (const report of reports) {
    console.log(`─── Migration: ${report.name} ───`);
    console.log(`  Statements            : ${report.statements}`);
    console.log(`  Estimated affected    : ${report.rowEstimate}`);
    console.log(
      `  ACCESS EXCLUSIVE lock  : ${report.requiresAccessExclusiveLock ? '⚠  YES' : '✓  No'}`
    );
    const rollback = report.hasDownMigration ? '✓  Present' : '⚠  Missing';
    console.log(`  Rollback path         : ${rollback}`);

    for (const warning of report.warnings) console.warn(`  ⚠  Warning: ${warning}`);
    for (const error of report.errors) console.error(`  ✗  Error: ${error}`);

    if (report.errors.length === 0 && report.warnings.length === 0) {
      console.log('  ✓  No issues detected');
    }
    console.log();
  }

  console.log(
    `Summary: ${summary.migrations} migration(s), ${summary.errorCount} error(s), ` +
      `${summary.warnCount} warning(s)\n`
  );
}

// ─── Entry point ────────────────────────────────────────────────────────────

function run(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    console.error(`[dry-run] ${err.message}`);
    return 2;
  }

  if (!fs.existsSync(options.migrationsDir)) {
    const message = `Migrations directory not found: ${options.migrationsDir}`;
    if (options.json) {
      process.stdout.write(JSON.stringify({ summary: null, error: message }, null, 2) + '\n');
    } else {
      console.warn(`[dry-run] ${message}`);
    }
    return 0;
  }

  const migrations = loadMigrations(options.migrationsDir);
  if (migrations.length === 0) {
    if (options.json) {
      printJson([], summarise([]));
    } else {
      console.log(`No migrations found in ${options.migrationsDir}. Nothing to dry-run.\n`);
    }
    return 0;
  }

  const reports = migrations.map((migration) => {
    const report = analyseMigration(migration.name, migration.up);
    report.hasDownMigration = migration.hasDown;
    return report;
  });

  const summary = summarise(reports);

  if (options.json) {
    printJson(reports, summary);
  } else {
    console.log(
      `Found ${migrations.length} migration(s) in: ${options.migrationsDir}\n` +
        `Timeout: ${options.timeoutMs}ms | Allow destructive: ${options.allowDestructive}\n`
    );
    printReport(reports, summary);
  }

  if (summary.errorCount > 0 && !options.allowDestructive) {
    console.error('✗  Dry-run failed: destructive or unsafe migration(s) detected.');
    console.error('   Pass --allow-destructive to override (requires manual approval).\n');
    return 1;
  }

  if (options.allowDestructive && summary.errorCount > 0) {
    console.warn('⚠  Proceeding despite findings (--allow-destructive).\n');
  }

  // --allow-destructive zeroes the error budget, so from here only the
  // configured --fail-on level can block the run.
  const gating = options.allowDestructive ? { ...summary, errorCount: 0 } : summary;
  if (shouldFail(gating, options.failOn)) {
    console.error(`✗  Dry-run failed: --fail-on ${options.failOn} threshold reached.\n`);
    return 1;
  }

  if (!options.json) {
    console.log('✓  Dry-run complete. No actual changes were made.\n');
  }
  return 0;
}

if (require.main === module) {
  // Overall wall-clock guard, so a pathological directory cannot hang CI.
  const timer = setTimeout(() => {
    console.error('✗  Dry-run timed out');
    process.exit(2);
  }, 30_000);
  timer.unref();

  try {
    const code = run(process.argv.slice(2));
    clearTimeout(timer);
    process.exit(code);
  } catch (err) {
    clearTimeout(timer);
    console.error('✗  Unexpected error:', err && err.message);
    process.exit(3);
  }
}

module.exports = {
  ACCESS_EXCLUSIVE_RULES,
  DESTRUCTIVE_RULES,
  LOCK_TIMEOUT_HINT,
  analyseMigration,
  hasDownMarker,
  loadMigrations,
  parseArgs,
  run,
  shouldFail,
  splitSections,
  splitStatements,
  stripComments,
  summarise,
};
