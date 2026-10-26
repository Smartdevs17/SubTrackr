/**
 * Tests for migration rollback parity (issue #1796).
 *
 * Verifies that every SQL migration in db/migrations/ and backend/migrations/
 * has a rollback path (inline -- @down section or paired .down.sql file) so
 * that `node scripts/db-migrate-run.js down` can revert any applied migration.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { loadMigrations, splitSections } = require('../db-migrate-run');
const { hasDownMarker } = require('../db-migrate-dryrun');

const MIGRATION_DIRS = [
  path.join(__dirname, '../../db/migrations'),
  path.join(__dirname, '../../backend/migrations'),
];

describe('migration rollback parity (issue #1796)', () => {
  for (const dir of MIGRATION_DIRS) {
    const label = path.relative(path.join(__dirname, '../..'), dir);

    describe(`directory: ${label}`, () => {
      const migrations = fs.existsSync(dir)
        ? fs
            .readdirSync(dir)
            .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
            .sort()
        : [];

      it('has at least one migration', () => {
        expect(migrations.length).toBeGreaterThan(0);
      });

      for (const file of migrations) {
        it(`${file} has a rollback path`, () => {
          const sql = fs.readFileSync(path.join(dir, file), 'utf8');
          const inlineDown = splitSections(sql).down.trim();
          const downFile = path.join(dir, file.replace(/\.sql$/, '.down.sql'));
          const pairedDown = fs.existsSync(downFile)
            ? fs.readFileSync(downFile, 'utf8').trim()
            : '';

          expect(inlineDown.length > 0 || pairedDown.length > 0).toBe(true);
        });

        it(`${file} down section is non-trivial (>= 10 chars)`, () => {
          const sql = fs.readFileSync(path.join(dir, file), 'utf8');
          const inlineDown = splitSections(sql).down.trim();
          const downFile = path.join(dir, file.replace(/\.sql$/, '.down.sql'));
          const pairedDown = fs.existsSync(downFile)
            ? fs.readFileSync(downFile, 'utf8').trim()
            : '';

          const down = inlineDown || pairedDown;
          expect(down.length).toBeGreaterThanOrEqual(10);
        });
      }
    });
  }

  it('db-migrate-run loadMigrations finds down sections for all migrations', () => {
    for (const dir of MIGRATION_DIRS) {
      if (!fs.existsSync(dir)) continue;
      const migrations = loadMigrations(dir);
      for (const migration of migrations) {
        expect(migration.down.length).toBeGreaterThan(0);
      }
    }
  });
});
