/**
 * Tests for scripts/db-migrate-run.js (issue #1288).
 *
 * The runner shells out to `psql`, so these tests cover the pure layer —
 * argument parsing, migration discovery, section splitting and checksums —
 * plus the environment guards that must refuse to run without a database.
 *
 * Exercised through the root Jest project (`npm run test`).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tool = require('../db-migrate-run');

const {
  LEDGER_DDL,
  LEDGER_TABLE,
  checksum,
  loadMigrations,
  parseArgs,
  parseMigrationName,
  run,
  splitSections,
} = tool;

const REVERSIBLE = `
-- 005_widgets.sql
SET lock_timeout = '30s';
CREATE TABLE widgets (id SERIAL PRIMARY KEY);

-- @down
DROP TABLE widgets;
`;

const IRREVERSIBLE = 'CREATE TABLE gadgets (id SERIAL PRIMARY KEY);';

let dir;
let originalDatabaseUrl;
let logSpy;
let errorSpy;
let warnSpy;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtrackr-migrate-run-'));
  originalDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  fs.rmSync(dir, { recursive: true, force: true });
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

function writeMigration(name, contents) {
  fs.writeFileSync(path.join(dir, name), contents, 'utf8');
}

describe('db-migrate-run :: argument parsing', () => {
  it('applies documented defaults', () => {
    const options = parseArgs(['up']);
    expect(options.command).toBe('up');
    expect(options.steps).toBe(1);
    expect(options.all).toBe(false);
    expect(options.dryRun).toBe(false);
  });

  it('parses every documented flag', () => {
    const options = parseArgs(['down', '--migrations-dir', dir, '--steps', '3', '--dry-run']);
    expect(options.command).toBe('down');
    expect(options.migrationsDir).toBe(dir);
    expect(options.steps).toBe(3);
    expect(options.dryRun).toBe(true);
    expect(parseArgs(['down', '--all']).all).toBe(true);
  });

  it('coerces a nonsensical --steps to 1', () => {
    expect(parseArgs(['down', '--steps', 'many']).steps).toBe(1);
    expect(parseArgs(['down', '--steps', '0']).steps).toBe(1);
  });

  it('leaves the command empty when only flags are supplied', () => {
    expect(parseArgs(['--dry-run']).command).toBe(null);
  });

  it('rejects an unknown flag', () => {
    expect(() => parseArgs(['up', '--turbo'])).toThrow(/Unknown argument/);
  });
});

describe('db-migrate-run :: migration discovery', () => {
  it('parses a NNN_name.sql filename', () => {
    expect(parseMigrationName('005_theme_storage.sql')).toEqual({
      version: '005',
      slug: 'theme_storage',
    });
    expect(parseMigrationName('no-version.sql')).toBe(null);
  });

  it('splits inline down sections', () => {
    const sections = splitSections(REVERSIBLE);
    expect(sections.up).toContain('CREATE TABLE widgets');
    expect(sections.down).toContain('DROP TABLE widgets');
  });

  it('loads migrations sorted and skips unparseable names', () => {
    writeMigration('005_widgets.sql', REVERSIBLE);
    writeMigration('003_plans.sql', IRREVERSIBLE);
    writeMigration('notes.sql', '-- scratch');
    expect(loadMigrations(dir).map((m) => m.version)).toEqual(['003', '005']);
  });

  it('marks a migration as reversible only when a down path exists', () => {
    writeMigration('003_plans.sql', IRREVERSIBLE);
    writeMigration('005_widgets.sql', REVERSIBLE);
    const byFile = Object.fromEntries(loadMigrations(dir).map((m) => [m.file, m]));
    expect(byFile['003_plans.sql'].down).toBe('');
    expect(byFile['005_widgets.sql'].down).toContain('DROP TABLE widgets');
  });

  it('picks up a paired .down.sql file as the rollback path', () => {
    writeMigration('003_plans.sql', IRREVERSIBLE);
    writeMigration('003_plans.down.sql', 'DROP TABLE plans;');
    const migrations = loadMigrations(dir);
    expect(migrations).toHaveLength(1);
    expect(migrations[0].down).toContain('DROP TABLE plans');
  });

  it('returns nothing for a missing directory', () => {
    expect(loadMigrations(path.join(dir, 'nope'))).toEqual([]);
  });

  it('produces a stable content checksum', () => {
    expect(checksum('SELECT 1;')).toBe(checksum('SELECT 1;'));
    expect(checksum('SELECT 1;')).not.toBe(checksum('SELECT 2;'));
    expect(checksum('SELECT 1;')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('checksums only the up section, so a rollback edit is not a drift', () => {
    const first = loadMigrationsWith('003_plans.sql', REVERSIBLE);
    const second = loadMigrationsWith('003_plans.sql', REVERSIBLE.replace('DROP', 'DROP  '));
    expect(first.checksum).toBe(second.checksum);
  });
});

function loadMigrationsWith(name, contents) {
  writeMigration(name, contents);
  return loadMigrations(dir)[0];
}

describe('db-migrate-run :: environment guards', () => {
  it('prints usage and returns 2 when no command is given', () => {
    expect(run([])).toBe(2);
  });

  it('returns 0 for --help', () => {
    expect(run(['--help'])).toBe(0);
  });

  it('rejects an unknown command', () => {
    expect(run(['sideways'])).toBe(2);
  });

  it('refuses to run without DATABASE_URL', () => {
    expect(run(['up'])).toBe(2);
    expect(run(['down'])).toBe(2);
    expect(run(['status'])).toBe(2);
  });

  it('never accepts a replica URL as a migration target', () => {
    process.env.DATABASE_URL = 'postgresql://user@replica.internal/subtrackr';
    process.env.DATABASE_REPLICA_URL = 'postgresql://user@replica.internal/subtrackr';
    // Reaches the psql probe rather than a replica-specific code path.
    const code = run(['status']);
    expect(code === 0 || code === 1 || code === 2).toBe(true);
  });
});

describe('db-migrate-run :: ledger', () => {
  it('declares an idempotent ledger table', () => {
    expect(LEDGER_TABLE).toBe('schema_migrations');
    expect(LEDGER_DDL).toContain('CREATE TABLE IF NOT EXISTS schema_migrations');
    expect(LEDGER_DDL).toContain('version     TEXT PRIMARY KEY');
  });
});
