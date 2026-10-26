# Subscription transaction batching and aggregation (Issue #1113)

Many subscription operations (charge, create, update, cancel, pause, resume) are
submitted as a **single batch transaction** instead of N separate ones, and every
run is aggregated into a summary so throughput and savings can be measured.

## Gas model

```
batch gas   = BATCH_BASE_GAS + count * GAS_PER_ITEM   (50_000 + 100_000 * n)
single gas  = count * 150_000
saved       = max(0, single - batch)
```

Batching 10 charges costs 1,050,000 instead of 1,500,000 – a saving of 450,000.

## Aggregation

Each run produces a `BatchAggregation`:

- `totalOperations` / `successfulOperations` / `failedOperations`
- `successRate`
- `gasSingle`, `gasBatch`, `gasSaved`
- `failuresByCode` – failure counts keyed by HTTP status
- `operationsByType` – counts keyed by operation name

Runs are retained (last 50) and rolled up by `aggregateRuns()` into
portfolio-level totals (`runs`, `successRate`, `gasSaved`, `rolledBackRuns`).

### Atomic vs non-atomic

With `atomic: true` (default) a single failing item marks the whole run
`rolledBack: true`; no partial state is kept. With `atomic: false` partial
successes are preserved.

## Limits

`MAX_BATCH_ITEMS = 100`. Larger batches are rejected with
`413 USAGE_BATCH_TOO_LARGE`.

## API

| Method | Path                          | Purpose                                  |
| ------ | ----------------------------- | ---------------------------------------- |
| `POST` | `/subscriptions/batch`        | Execute a batch, returns the run + stats |
| `GET`  | `/subscriptions/batch/stats`  | Aggregate statistics across runs         |
| `GET`  | `/subscriptions/batch/:runId` | Fetch one historical run                 |

### Example

```bash
curl -X POST http://localhost:3000/subscriptions/batch \
  -H 'content-type: application/json' \
  -d '{
    "atomic": true,
    "operations": [
      { "operation": "charge", "subscriptionId": "a" },
      { "operation": "charge", "subscriptionId": "b" }
    ]
  }'
```

Errors:

- `422 USAGE_INVALID_EVENT` – missing or malformed `operations`
- `413 USAGE_BATCH_TOO_LARGE` – more than 100 operations
- `404 NOT_FOUND` – unknown run id

## Code map

- `backend/subscription/domain/batchAggregation.ts` – gas model + aggregation
- `backend/subscription/domain/batchRunStore.ts` – run registry and execution
- `backend/subscription/controller/batchController.ts` – HTTP handlers
- `backend/subscription/router/subscriptionOpsRouter.ts` – route table
- `contracts/batch/` – on-chain batch contract (see `contracts/batch/BATCHING_API.md`)
- `app/services/batchTransactionService.ts` – client-side batching

## Tests

```bash
npx jest -c jest.backend.config.js backend/subscription/domain/__tests__/batchAggregation.test.ts
npx jest -c jest.backend.config.js backend/subscription/router/__tests__/subscriptionOpsRouter.test.ts
```
