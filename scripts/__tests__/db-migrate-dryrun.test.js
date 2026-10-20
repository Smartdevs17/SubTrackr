/**
 * Tests for scripts/db-migrate-dryrun.js (issue #1288).
 *
 * Exercised through the root Jest project (`npm run test`), which picks up
 * `scripts/__tests__` via the `**\/__tests__/**` testMatch glob.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tool = require('../db-migrate-dryrun');

const {
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
} = tool;

const SAFE_MIGRATION = `
-- 005_example.sql
SET lock_timeout = '30s';

CREATE TABLE IF NOT EXISTS widgets (
  id    SERIAL PRIMARY KEY,
  label TEXT NOT NULL DEFAULT 'none'
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS widgets_label_idx ON widgets (label);

-- @down
DROP TABLE IF EXISTS widgets;
`;

const DESTRUCTIVE_MIGRATION = `
SET lock_timeout = '30s';
DROP TABLE legacy_events;
`;

let dir;
let logSpy;
let errorSpy;
let warnSpy;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtrackr-dryrun-'));
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeMigration(name, contents) {
  fs.writeFileSync(path.join(dir, name), contents, 'utf8');
}

describe('db-migrate-dryrun :: SQL parsing', () => {
  it('strips line comments so they cannot trip the rules', () => {
    const sql = '-- DROP TABLE sneaky;\nSELECT 1;';
    expect(stripComments(sql)).toBe('\nSELECT 1;');
  });

  it('splits a migration into up and down sections', () => {
    const sections = splitSections(SAFE_MIGRATION);
    expect(sections.up).toContain('CREATE TABLE IF NOT EXISTS widgets');
    expect(sections.up).not.toContain('DROP TABLE IF EXISTS widgets');
    expect(sections.down).toContain('DROP TABLE IF EXISTS widgets');
  });

  it('treats the whole file as up when there is no down marker', () => {
    const sections = splitSections('SELECT 1;');
    expect(sections.down).toBe('');
  });

  it('detects both @down and plain "down" markers', () => {
    expect(hasDownMarker('-- @down\nDROP TABLE x;')).toBe(true);
    expect(hasDownMarker('-- down\nDROP TABLE x;')).toBe(true);
    expect(hasDownMarker('SELECT 1;')).toBe(false);
  });

  it('splits SQL into statements and drops empty fragments', () => {
    const statements = splitStatements('-- a comment\nSELECT 1;\n\n;\nSELECT 2;');
    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe('SELECT 1');
  });
});

describe('db-migrate-dryrun :: analysis', () => {
  it('passes an idempotent, concurrent, lock-guarded migration', () => {
    const report = analyseMigration('005_example.sql', SAFE_MIGRATION);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.requiresAccessExclusiveLock).toBe(false);
    expect(report.destructive).toBe(false);
    expect(report.hasDownMigration).toBe(true);
    expect(report.statements).toBe(3);
  });

  it('flags DROP TABLE as a destructive error', () => {
    const report = analyseMigration('006_bad.sql', DESTRUCTIVE_MIGRATION);
    expect(report.errors).toContain('DROP TABLE');
    expect(report.destructive).toBe(true);
  });

  it('flags TRUNCATE as a destructive error', () => {
    const report = analyseMigration('007_bad.sql', 'TRUNCATE events;');
    expect(report.destructive).toBe(true);
  });

  it('flags NOT NULL columns added without a DEFAULT', () => {
    const report = analyseMigration(
      '008_bad.sql',
      "SET lock_timeout = '30s';\nALTER TABLE widgets ADD COLUMN owner TEXT NOT NULL;"
    );
    expect(report.errors.join(' ')).toContain('NOT NULL without DEFAULT');
  });

  it('accepts NOT NULL when a DEFAULT is supplied', () => {
    const report = analyseMigration(
      '009_ok.sql',
      "SET lock_timeout = '30s';\nALTER TABLE widgets ADD COLUMN owner TEXT NOT NULL DEFAULT 'anon';"
    );
    expect(report.errors).toEqual([]);
  });

  it('warns when an ALTER TABLE has no lock_timeout guard', () => {
    const report = analyseMigration('010_bad.sql', 'ALTER TABLE widgets ADD COLUMN a TEXT;');
    expect(report.warnings.join(' ')).toContain(LOCK_TIMEOUT_HINT);
  });

  it('flags a CREATE INDEX that is not CONCURRENT', () => {
    const report = analyseMigration('011_bad.sql', 'CREATE INDEX widgets_a ON widgets (a);');
    expect(report.warnings.join(' ')).toContain('CONCURRENTLY');
  });

  it('does not flag a CREATE INDEX CONCURRENTLY', () => {
    const report = analyseMigration(
      '012_ok.sql',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS widgets_a ON widgets (a);'
    );
    expect(report.warnings.join(' ')).not.toContain('CONCURRENTLY');
  });

  it('flags VACUUM FULL and SET NOT NULL as lock-heavy', () => {
    expect(analyseMigration('a.sql', 'VACUUM FULL widgets;').requiresAccessExclusiveLock).toBe(
      true
    );
    expect(
      analyseMigration('b.sql', 'ALTER TABLE widgets ALTER COLUMN a SET NOT NULL;')
        .requiresAccessExclusiveLock
    ).toBe(true);
  });

  it('reports a missing rollback path', () => {
    const report = analyseMigration('013_bad.sql', 'CREATE TABLE t (id INT);');
    expect(report.hasDownMigration).toBe(false);
  });

  it('estimates whether a full scan is likely', () => {
    expect(analyseMigration('a.sql', 'DELETE FROM t WHERE id = 1;').rowEstimate).toContain(
      'partial'
    );
    expect(analyseMigration('b.sql', 'DELETE FROM t;').rowEstimate).toContain('full scan');
  });

  it('handles an empty migration without throwing', () => {
    const report = analyseMigration('empty.sql', '');
    expect(report.statements).toBe(0);
    expect(report.errors).toEqual([]);
  });
});

describe('db-migrate-dryrun :: summary', () => {
  it('aggregates errors, warnings and missing rollbacks', () => {
    const summary = summarise([
      analyseMigration('a.sql', DESTRUCTIVE_MIGRATION),
      analyseMigration('b.sql', 'CREATE TABLE t (id INT);'),
    ]);
    expect(summary.migrations).toBe(2);
    expect(summary.errorCount).toBe(1);
    expect(summary.missingRollback).toEqual(['a.sql', 'b.sql']);
  });

  it('honours the configured fail-on threshold', () => {
    const summary = { errorCount: 1, warnCount: 3 };
    expect(shouldFail(summary, 'none')).toBe(false);
    expect(shouldFail(summary, 'error')).toBe(true);
    expect(shouldFail(summary, 'warn')).toBe(true);
    expect(shouldFail({ errorCount: 0, warnCount: 3 }, 'error')).toBe(false);
    expect(shouldFail({ errorCount: 0, warnCount: 3 }, 'warn')).toBe(true);
  });
});

describe('db-migrate-dryrun :: migration loading', () => {
  it('pairs a migration with its inline down section', () => {
    writeMigration('005_example.sql', SAFE_MIGRATION);
    const migrations = loadMigrations(dir);
    expect(migrations).toHaveLength(1);
    expect(migrations[0].name).toBe('005_example.sql');
    expect(migrations[0].hasDown).toBe(true);
  });

  it('pairs a migration with a separate .down.sql file', () => {
    writeMigration('006_ok.sql', 'CREATE TABLE t (id INT);');
    writeMigration('006_ok.down.sql', 'DROP TABLE t;');
    const migrations = loadMigrations(dir);
    expect(migrations).toHaveLength(1);
    expect(migrations[0].hasDown).toBe(true);
    expect(migrations[0].down).toContain('DROP TABLE t');
  });

  it('does not treat a .down.sql file as its own migration', () => {
    writeMigration('007_ok.sql', 'CREATE TABLE t (id INT);');
    writeMigration('007_ok.down.sql', 'DROP TABLE t;');
    expect(loadMigrations(dir).map((m) => m.name)).toEqual(['007_ok.sql']);
  });

  it('reports no migrations for a missing directory', () => {
    expect(loadMigrations(path.join(dir, 'nope'))).toEqual([]);
  });
});

describe('db-migrate-dryrun :: CLI', () => {
  it('applies documented defaults', () => {
    const options = parseArgs([]);
    expect(options.failOn).toBe('error');
    expect(options.json).toBe(false);
    expect(options.allowDestructive).toBe(false);
    expect(options.timeoutMs).toBe(30_000);
  });

  it('parses every documented flag', () => {
    const options = parseArgs([
      '--migrations-dir',
      dir,
      '--json',
      '--allow-destructive',
      '--fail-on',
      'warn',
      '--timeout',
      '5000',
    ]);
    expect(options.migrationsDir).toBe(dir);
    expect(options.json).toBe(true);
    expect(options.allowDestructive).toBe(true);
    expect(options.failOn).toBe('warn');
    expect(options.timeoutMs).toBe(5_000);
  });

  it('rejects an invalid --fail-on level and a non-numeric timeout', () => {
    expect(() => parseArgs(['--fail-on', 'sometimes'])).toThrow(/fail-on/);
    expect(() => parseArgs(['--timeout', 'soon'])).toThrow(/timeout/);
    expect(() => parseArgs(['--timeout', '-5'])).toThrow(/timeout/);
  });

  it('returns exit code 2 for a usage error', () => {
    expect(run(['--fail-on', 'sometimes'])).toBe(2);
  });

  it('returns exit code 0 when the migrations directory is absent', () => {
    expect(run(['--migrations-dir', path.join(dir, 'nope')])).toBe(0);
  });

  it('returns exit code 0 for an empty migrations directory', () => {
    expect(run(['--migrations-dir', dir])).toBe(0);
  });

  it('passes a clean migration set', () => {
    writeMigration('005_example.sql', SAFE_MIGRATION);
    expect(run(['--migrations-dir', dir])).toBe(0);
  });

  it('fails a destructive migration set', () => {
    writeMigration('006_bad.sql', DESTRUCTIVE_MIGRATION);
    expect(run(['--migrations-dir', dir])).toBe(1);
  });

  it('lets --allow-destructive override a destructive migration set', () => {
    writeMigration('006_bad.sql', DESTRUCTIVE_MIGRATION);
    expect(run(['--migrations-dir', dir, '--allow-destructive'])).toBe(0);
  });

  it('fails on warnings when --fail-on warn is requested', () => {
    writeMigration('007_warn.sql', 'CREATE INDEX widgets_a ON widgets (a);');
    expect(run(['--migrations-dir', dir])).toBe(0);
    expect(run(['--migrations-dir', dir, '--fail-on', 'warn'])).toBe(1);
  });

  it('emits parseable JSON with no trailing human output', () => {
    writeMigration('006_bad.sql', DESTRUCTIVE_MIGRATION);
    const chunks = [];
    const write = jest.spyOn(process.stdout, 'write').mockImplementation((value) => {
      chunks.push(value);
      return true;
    });
    try {
      run(['--migrations-dir', dir, '--json', '--allow-destructive']);
      const payload = JSON.parse(chunks.join(''));
      expect(payload.summary.migrations).toBe(1);
      expect(payload.summary.errorCount).toBe(1);
      expect(payload.migrations[0].destructive).toBe(true);
    } finally {
      write.mockRestore();
    }
  });
});
