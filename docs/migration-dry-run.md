# Schema migration dry-run

**Issue:** #1288 — Build schema migration dry-run tool

Two tools, both zero-dependency:

| Tool                              | Purpose                                       |
| --------------------------------- | --------------------------------------------- |
| `scripts/db-migrate-dryrun.js`    | static analysis of `.sql` migrations, no DB    |
| `scripts/db-migrate-run.js`       | transactional `up` / `down` / `status` runner |

## Static dry-run

```bash
# Analyse every migration; fail on errors
npm run db:migrate:dry-run

# Treat warnings as failures too (stricter, for main)
npm run db:migrate:lint

# Direct invocation
node scripts/db-migrate-dryrun.js --migrations-dir backend/migrations --fail-on warn
node scripts/db-migrate-dryrun.js --json          # machine-readable report
node scripts/db-migrate-dryrun.js --allow-destructive
```

### Rules

**Errors** — these will take the lock you least want to hold, or break a
running app:

- `DROP TABLE`
- `DROP COLUMN`
- `TRUNCATE`
- `ALTER TABLE … ADD COLUMN … NOT NULL` with no `DEFAULT`, which fails outright
  on a non-empty table

**Warnings** — cheap to fix now, expensive later:

- `DROP INDEX` / `DROP TRIGGER` / `DROP TYPE` / `DROP DATABASE` / `DROP SCHEMA`
- an unbounded `DELETE FROM …;` with no `WHERE` clause
- an `ALTER TABLE` with no `lock_timeout` guard
- `CREATE INDEX` without `CONCURRENTLY`
- statements that take an `ACCESS EXCLUSIVE` lock, blocking all reads and writes
  on the table for their duration: `ADD COLUMN … NOT NULL`, `SET NOT NULL`,
  `ADD CONSTRAINT`, `ALTER COLUMN … TYPE`, `VACUUM FULL`, `CLUSTER`, `REINDEX`,
  and a non-concurrent `CREATE INDEX`

`--allow-destructive` zeroes the error budget, leaving only the `--fail-on`
threshold able to block the run. Use it for an intentional destructive change
that has been reviewed.

### Rollback paths

Every migration is expected to have one, and the report says so explicitly
(`Rollback path: Present / Missing`, plus a `missingRollback` list in the JSON
summary). Two supported layouts:

```sql
-- inline, in the same file
ALTER TABLE widgets ADD COLUMN label TEXT;
-- @down
ALTER TABLE widgets DROP COLUMN label;
```

```sql
-- or a paired file: 005_widgets.sql + 005_widgets.down.sql
```

### Exit codes

| Code | Meaning                                                            |
| ---- | ------------------------------------------------------------------ |
| `0`  | no findings at or above the `--fail-on` threshold                   |
| `1`  | threshold reached (`--fail-on error` is the default)                |
| `2`  | usage error, or `--migrations-dir` that does not exist              |

> **Baseline assumption.** The migrations in `backend/migrations` are
> incremental: `003_plans_cache_columns.sql` expects a `plans` table and
> `004_theme_storage.sql` expects `merchants`, both created by the base Prisma
> schema. The dry-run is a *static* analyser and does not need those tables, but
> the runner below will fail on a genuinely empty database.

## Applying migrations

```bash
export DATABASE_URL=postgresql://user:pass@host:5432/subtrackr

npm run db:migrate:status        # what is applied, and whether it drifted
npm run db:migrate:up             # apply every pending migration
npm run db:migrate:down           # roll back everything (rollback parity)
npm run db:migrate:down:1         # roll back a single migration
```

### How the runner behaves

- **Ledger.** Applied versions are recorded in `schema_migrations` with a
  checksum of each migration's *up* section. Editing a rollback section is not
  drift; editing the up section is, and `status` reports it.
- **Transactions.** Each migration runs inside its own transaction with
  `ON_ERROR_STOP`, so a failure leaves no half-applied migration and no ledger
  entry. DDL that cannot run in a transaction (`CREATE INDEX CONCURRENTLY`) is
  run outside it, which is exactly why those statements are warned about by the
  dry-run tool.
- **`--dry-run`.** Prints the plan without opening a transaction.
- **Guards.** Refuses to run without `DATABASE_URL`, and refuses with a clear
  error when `psql` is not on `PATH`, rather than failing mid-migration.

### Rollback parity

`down` only rolls back migrations that actually have a down path, and it says
loudly which applied versions it skipped because none exists. A migration with
no rollback is one you cannot deploy safely, which is why the dry-run tool
reports a missing rollback path for every migration.

> The migrations currently in `backend/migrations` (`003`, `004`) predate this
> tool and have no down path, so the `up → down → up` job in
> `db-migration.yml` will warn and roll nothing back until down migrations are
> added. That is the tooling correctly surfacing a real gap, not a failure of
> the runner.

## CI

`.github/workflows/db-migration.yml` (manual dispatch) exercises the full
`up → down → up` cycle against a `postgres:16` service, and now resolves the
`db:migrate:up` / `db:migrate:down` scripts. Every PR is gated by the static
dry-run through `.github/workflows/ops-tooling-checks.yml`, which needs no
database and no dependency install.

## Tests

```bash
npx jest scripts/__tests__/db-migrate-dryrun.test.js scripts/__tests__/db-migrate-run.test.js
```

Covers section splitting, every analysis rule, migration discovery and pairing,
checksum stability, argument parsing, and the environment guards.
