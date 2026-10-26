# Migration Rollback Support

## Overview

All SubTrackr migrations support forward (`up`) and reverse (`down`) operations.
The migration runner (`scripts/db-migrate-run.js`) maintains a `schema_migrations`
ledger table so that:

- `up` is idempotent — re-running applies only pending migrations.
- `down` rolls back the most recent migration(s) or all reversible migrations.
- Each migration runs in its own transaction, so a failure leaves the ledger
  consistent with the database.
- A migration is only marked applied when its down section exists, enforcing
  rollback parity.

## Rollback path format

Every migration must include a rollback path, provided in one of two ways:

### 1. Inline `-- @down` section

```sql
CREATE TABLE widgets (id SERIAL PRIMARY KEY);

-- @down
DROP TABLE widgets;
```

Everything after the `-- @down` (or `-- down`) marker is the rollback section.

### 2. Paired `.down.sql` file

```
005_widgets.sql          # forward migration
005_widgets.down.sql     # rollback migration
```

## Commands

```bash
# Apply all pending migrations
node scripts/db-migrate-run.js up

# Dry-run (show what would be applied without touching the database)
node scripts/db-migrate-run.js up --dry-run

# Roll back the most recent migration
node scripts/db-migrate-run.js down

# Roll back the last 3 migrations
node scripts/db-migrate-run.js down --steps 3

# Roll back all reversible migrations
node scripts/db-migrate-run.js down --all

# Show migration status (applied vs pending, rollback availability)
node scripts/db-migrate-run.js status
```

## Dry-run analysis (no database required)

```bash
# Analyse migrations for safety issues without a database connection
node scripts/db-migrate-dryrun.js

# JSON output for CI integration
node scripts/db-migrate-dryrun.js --json
```

The dry-run tool reports:

- Destructive changes (DROP / TRUNCATE)
- Statements requiring ACCESS EXCLUSIVE locks
- NOT NULL columns added without DEFAULT
- ALTER statements without lock_timeout guards
- Migrations with no rollback path

## Safety guarantees

1. **Transaction per migration**: Each migration (up or down) runs in a
   `BEGIN/COMMIT` block. A failure rolls back the entire migration.

2. **CONCURRENTLY note**: `CREATE INDEX CONCURRENTLY` and `DROP INDEX
CONCURRENTLY` cannot run inside a transaction. The runner wraps each
   migration in a transaction, so migrations using `CONCURRENTLY` should
   structure their down section to match. The ledger insert is in the same
   transaction as the migration body.

3. **Ledger consistency**: The `schema_migrations` table records the version
   and checksum of each applied migration. `down` deletes the ledger row in
   the same transaction as the rollback SQL.

4. **Irreversible migrations are flagged**: If a migration has no down path,
   `up` warns and `down` skips it with a message listing the irreversible
   versions.

## Migration directories

| Directory             | Contents                                            |
| --------------------- | --------------------------------------------------- |
| `db/migrations/`      | Core schema migrations (indexes, views, tables)     |
| `backend/migrations/` | Backend-specific migrations (cache columns, themes) |

Default migration directory for the runner is `backend/migrations/`. Use
`--migrations-dir db/migrations` to target the core schema directory.
