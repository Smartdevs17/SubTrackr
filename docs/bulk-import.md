# Bulk subscription import

Import many subscriptions from a CSV file, with duplicate detection and a
result for every row.

## CLI

```bash
subtrackr subscriptions import subscriptions.csv --dry-run   # validate only
subtrackr subscriptions import subscriptions.csv             # import
subtrackr subscriptions import subscriptions.csv --format json
```

The exit code is `1` when any row failed, `0` otherwise (duplicates are not
failures).

## CSV format

| Column              | Required | Rules                                          |
| ------------------- | -------- | ---------------------------------------------- |
| `name`              | yes      | 1–120 characters                               |
| `price`             | yes      | Positive number, at most 2 decimals            |
| `currency`          | yes      | 3-letter ISO code (case-insensitive)           |
| `billing_cycle`     | yes      | `weekly`, `monthly`, `quarterly` or `yearly`   |
| `next_billing_date` | no       | Real calendar date, `YYYY-MM-DD`               |
| `category`          | no       | Free text                                      |

Columns can be in any order; unknown columns are ignored. Quoted fields,
escaped quotes (`""`), embedded commas/newlines, CRLF and a UTF-8 BOM are
supported. A file is limited to 1000 rows.

## Duplicates

Two rows are the same subscription when **name** (case and spacing ignored),
**currency** and **billing cycle** match. A row is skipped as a duplicate of an
existing subscription or of an earlier row in the same file (the report names
which). Re-running the same file is therefore safe: rows created last time show
up as duplicates.

## Per-row results

Every row ends as `created`, `would_create` (dry run), `duplicate` or `error`.
An error lists each failing field. One bad row never blocks the others.
Line numbers are CSV record numbers; the header is line 1.

## Backend service

`backend/src/services/import.ts` is the authoritative implementation:
`importSubscriptions(csv, { existing, create, logger }, { dryRun, maxRows })`.
Storage and logging are injected. It logs one structured summary line
(`total`, `created`, `duplicates`, `failed`, `dryRun`) per import and a warning
for ignored columns. The CLI applies the same rules client-side and reports
server rejections per row.
