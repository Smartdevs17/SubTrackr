/**
 * Tests for scripts/db-index-audit.js (issue #1798).
 *
 * Tests the pure analysis layer: index parsing, query pattern extraction,
 * coverage detection, and gap reporting.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  extractQueryPatterns,
  isCoveredByIndex,
  loadIndexes,
  parseCreateIndex,
  run,
  deduplicatePatterns,
} = require('../db-index-audit');

let tmpDir;
let migrationsDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'index-audit-'));
  migrationsDir = path.join(tmpDir, 'migrations');
  fs.mkdirSync(migrationsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeMigration(name, sql) {
  fs.writeFileSync(path.join(migrationsDir, name), sql, 'utf8');
}

describe('db-index-audit :: parseCreateIndex', () => {
  it('parses a basic CREATE INDEX', () => {
    const sql = 'CREATE INDEX idx_foo ON users (email);';
    const idx = parseCreateIndex(sql);
    expect(idx).toEqual({
      name: 'idx_foo',
      table: 'users',
      columns: ['email'],
      partial: null,
    });
  });

  it('parses CREATE INDEX CONCURRENTLY IF NOT EXISTS with composite columns', () => {
    const sql =
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bar ON subscriptions (user_id, status) WHERE status = 'active';";
    const idx = parseCreateIndex(sql);
    expect(idx.name).toBe('idx_bar');
    expect(idx.table).toBe('subscriptions');
    expect(idx.columns).toEqual(['user_id', 'status']);
    expect(idx.partial).toContain("status = 'active'");
  });

  it('parses a UNIQUE index', () => {
    const sql = 'CREATE UNIQUE INDEX idx_uq ON users (email);';
    const idx = parseCreateIndex(sql);
    expect(idx.name).toBe('idx_uq');
    expect(idx.table).toBe('users');
  });

  it('returns null for non-index statements', () => {
    expect(parseCreateIndex('SELECT * FROM users;')).toBeNull();
    expect(parseCreateIndex('CREATE TABLE foo (id INT);')).toBeNull();
  });
});

describe('db-index-audit :: loadIndexes', () => {
  it('loads indexes from migration files', () => {
    writeMigration(
      '001_init.sql',
      `
      CREATE INDEX IF NOT EXISTS idx_a ON users (email);
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_b ON subscriptions (user_id, status);
    `
    );
    const indexes = loadIndexes([migrationsDir]);
    expect(indexes).toHaveLength(2);
    expect(indexes[0].name).toBe('idx_a');
    expect(indexes[1].name).toBe('idx_b');
  });

  it('ignores indexes in -- @down sections', () => {
    writeMigration(
      '001_init.sql',
      `
      CREATE INDEX IF NOT EXISTS idx_up ON users (email);

-- @down
DROP INDEX IF EXISTS idx_up;
    `
    );
    const indexes = loadIndexes([migrationsDir]);
    expect(indexes).toHaveLength(1);
    expect(indexes[0].name).toBe('idx_up');
  });

  it('returns empty for non-existent directory', () => {
    expect(loadIndexes(['/nonexistent'])).toEqual([]);
  });
});

describe('db-index-audit :: isCoveredByIndex', () => {
  const indexes = [
    { name: 'idx_a', table: 'users', columns: ['email'], partial: null },
    { name: 'idx_b', table: 'subscriptions', columns: ['user_id', 'status'], partial: null },
  ];

  it('covers a single-column query when index first column matches', () => {
    expect(isCoveredByIndex({ table: 'users', columns: ['email'], type: 'WHERE' }, indexes)).toBe(
      true
    );
  });

  it('covers a composite query when index is a prefix match', () => {
    expect(
      isCoveredByIndex(
        { table: 'subscriptions', columns: ['user_id', 'status'], type: 'WHERE' },
        indexes
      )
    ).toBe(true);
  });

  it('does not cover when no index exists for the table', () => {
    expect(
      isCoveredByIndex({ table: 'orders', columns: ['user_id'], type: 'WHERE' }, indexes)
    ).toBe(false);
  });

  it('always covers id lookups (primary key)', () => {
    expect(isCoveredByIndex({ table: 'users', columns: ['id'], type: 'WHERE' }, [])).toBe(true);
  });

  it('does not cover when the column is not the leading column', () => {
    expect(
      isCoveredByIndex({ table: 'subscriptions', columns: ['status'], type: 'WHERE' }, indexes)
    ).toBe(false);
  });
});

describe('db-index-audit :: extractQueryPatterns', () => {
  it('extracts WHERE column = $N patterns', () => {
    const content = '`SELECT * FROM users WHERE email = $1`';
    const patterns = extractQueryPatterns(content, 'test.ts');
    expect(patterns).toContainEqual({
      table: 'users',
      columns: ['email'],
      type: 'WHERE',
      file: 'test.ts',
    });
  });

  it('extracts FROM table WHERE column patterns', () => {
    const content = '`SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC`';
    const patterns = extractQueryPatterns(content, 'test.ts');
    const wherePattern = patterns.find((p) => p.type === 'WHERE');
    expect(wherePattern.table).toBe('subscriptions');
    expect(wherePattern.columns).toEqual(['user_id']);
  });
});

describe('db-index-audit :: deduplicatePatterns', () => {
  it('removes duplicate patterns', () => {
    const patterns = [
      { table: 'users', columns: ['email'], type: 'WHERE', file: 'a.ts' },
      { table: 'users', columns: ['email'], type: 'WHERE', file: 'b.ts' },
      { table: 'users', columns: ['id'], type: 'WHERE', file: 'c.ts' },
    ];
    const deduped = deduplicatePatterns(patterns);
    expect(deduped).toHaveLength(2);
  });
});

describe('db-index-audit :: run', () => {
  it('exits 0 when no gaps (all covered)', () => {
    writeMigration('001.sql', 'CREATE INDEX IF NOT EXISTS idx_email ON users (email);');
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, 'repo.ts'),
      '`SELECT * FROM users WHERE email = $1`',
      'utf8'
    );

    const code = run(['--migrations-dir', migrationsDir, '--src-dir', srcDir]);
    expect(code).toBe(0);
  });

  it('exits 1 when gaps are found', () => {
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, 'repo.ts'),
      '`SELECT * FROM users WHERE email = $1`',
      'utf8'
    );

    const code = run(['--migrations-dir', migrationsDir, '--src-dir', srcDir]);
    expect(code).toBe(1);
  });

  it('outputs JSON when --json is passed', () => {
    writeMigration('001.sql', 'CREATE INDEX IF NOT EXISTS idx_email ON users (email);');
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, 'repo.ts'),
      '`SELECT * FROM users WHERE email = $1`',
      'utf8'
    );

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    run(['--json', '--migrations-dir', migrationsDir, '--src-dir', srcDir]);
    const jsonOutput = logSpy.mock.calls.map((c) => c[0]).join('\n');
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.indexesFound).toBe(1);
    logSpy.mockRestore();
  });
});
