# PgBouncer worker sizing presets (issue #2076)

`presets.json` is the single source of truth for PgBouncer pool sizing. The
backend loads the same resolver from `render.js` through
`backend/config/database.ts`, so the client pool cap and the server-side pool
cannot be tuned independently by accident.

| Preset | Worker concurrency | Client pool (`DB_POOL_MAX`) | Server pool (`default_pool_size`) | Reserve | Max clients |
|---|---:|---:|---:|---:|---:|
| `small` | 4 | 8 | 10 | 2 | 100 |
| `standard` (default) | 10 | 20 | 25 | 5 | 200 |
| `large` | 20 | 40 | 40 | 10 | 400 |
| `batch` | 32 | 60 | 60 | 15 | 600 |

`defaultPoolSize` is the number of real Postgres connections PgBouncer keeps
per database. The reserve pool is only used when clients wait longer than
`reserve_pool_timeout`, so the worst-case server budget is
`default_pool_size + reserve_pool_size`. `max_client_conn` is sized for at
least four times the server pool to absorb worker bursts without rejecting
connections.

## Selecting a preset

Set `PGBOUNCER_PRESET` in the worker/deployment environment:

```bash
PGBOUNCER_PRESET=large node infra/pgbouncer/render.js --db-host postgres.internal \
  --output /etc/pgbouncer/pgbouncer.ini
```

An unknown preset falls back to `standard` with a warning instead of leaving
the service unconfigured. `DB_REPLICA_POOL_SIZE` still overrides the preset's
`default_pool_size` for a single host when needed; invalid values fall back to
the preset default. Both fallbacks emit a `[PgBouncer]` console warning and an
optional `onPgBouncerSizingEvent` hook from `loadDatabaseConfig()` so they can
be forwarded to metrics/alerting.

## Rendering and checking configuration

- `pgbouncer.ini.tmpl` — template with placeholders, edited by hand.
- `pgbouncer.ini` — generated output for the default `standard` preset,
  committed so container deployments can mount it directly.
- `render.js` — pure Node renderer; supports `--preset`, `--db-host`,
  `--replica-pool-size`, `--output`, `--check` and `--help`.

```bash
node infra/pgbouncer/render.js --check
node infra/pgbouncer/render.js --preset small --db-host pgbouncer-replica-1.internal
```

`--check` fails when the committed/generated ini no longer matches the current
preset catalog. CI runs this through the preset tests.

## Transaction pooling safety

Every preset forces `pool_mode = transaction`, `server_reset_query = DISCARD
ALL` and `server_reset_query_always = 1`. Application code must not rely on
session state between transactions:

- no `LISTEN`/`NOTIFY`, session-level `SET`, advisory locks or `WITH HOLD`
  cursors through the pool;
- prepared statements are enabled via `max_prepared_statements` on PgBouncer
  >= 1.21, but statement names must be scoped to a single transaction;
- `ignore_startup_parameters = extra_float_digits` keeps `pg` clients from
  failing startup in transaction mode.

## Exhaustion and rollback

If `waitingCount` rises, the reserve pool absorbs short bursts. Sustained
waiting means the chosen preset is too small: move one tier up (`standard` →
`large`) rather than raising `DB_POOL_MAX` alone, then re-render the ini and
restart the proxy. To roll back, set `PGBOUNCER_PRESET=standard` (or re-run the
renderer without `--preset`) and verify with `--check`. Changing a preset does
not mutate the database or application data, so rollback is a config-only
restart.
