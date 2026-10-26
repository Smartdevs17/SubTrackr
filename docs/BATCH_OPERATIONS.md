# Batch Subscription Operations

## Overview

Merchants managing hundreds of subscriptions need to act on them as a group rather than
one at a time. Batch operations bundle a single operation kind — create, update, charge or
cancel — across many subscriptions, with an atomic execution guarantee, tracked status,
after-the-fact rollback, and analytics on success rate and timing.

The feature spans four layers:

| Layer      | Location                                  | Responsibility                                       |
| ---------- | ----------------------------------------- | ---------------------------------------------------- |
| Contract   | `contracts/batch/src/lib.rs`              | On-chain execution, atomicity, status, analytics      |
| Service    | `app/services/batchTransactionService.ts` | Client orchestration, chunking, retry, CSV, export    |
| Store      | `app/stores/batchStore.ts`                | Draft state, configuration, history, analytics        |
| UI         | `app/screens/BatchOperationsScreen.tsx`   | Operator workflow                                    |

## Operation types

| Type     | `params[i]` means      | Effect                                    |
| -------- | ---------------------- | ----------------------------------------- |
| `create` | initial price          | Registers a new subscription              |
| `update` | new price              | Rewrites the subscription price           |
| `charge` | amount to charge       | Adds to the subscription's charged total  |
| `cancel` | cancel reason code     | Deactivates the subscription              |

Cancel reason codes are `0` too expensive, `1` no longer needed, `2` found alternative,
`3` poor service, `4` other. Use `cancel_reason_code` / `cancel_reason_from_code` rather
than hard-coding the integers. Reasons are optional: an empty `params` vector records
`Other` for every item.

## Status tracking

Every batch moves through an explicit state machine, mirrored between the contract's
`BatchState` and the client's `BatchState`:

```
pending ──▶ processing ──▶ completed            (no item failed)
                        ├▶ partial              (some items failed, non-atomic)
                        └▶ failed               (atomic batch discarded its writes)

completed / partial ──▶ rolled_back             (explicit reversal)
```

`get_batch_status(batch_id)` returns the state alongside `total`, `succeeded`, `failed`
and the `started_at` / `completed_at` ledger timestamps, so a caller can compute progress
and duration without replaying the batch. On the client, `useBatchStore().progress`
exposes the same shape with a `percentComplete` for progress bars.

## Atomic execution guarantee

An atomic batch stages every write and flushes it only after the last item succeeds. The
first failure aborts the run, the staging area is discarded, and the batch reports
`failed` with `rolled_back: true` and `successful_operations: 0`. Callers therefore never
observe a half-applied batch.

A non-atomic batch commits each item as it succeeds and finishes `partial`, reporting per
item outcomes so the operator can retry only what failed.

Atomicity is chosen per run. `create_batch_operation(owner, operation, atomic)` takes an
explicit flag; `create_batch_operation_default(owner, operation)` uses the operation
type's configured `atomic_default`.

## Rollback

A batch that already committed can still be undone. During execution the contract records
a `SnapshotEntry` per touched subscription capturing whether it existed and its prior
state. `rollback_batch(caller, batch_id)` replays that snapshot: subscriptions the batch
created are removed, and pre-existing subscriptions are restored byte for byte.

Rules enforced by the contract:

- Only the batch owner or the contract admin may roll back.
- The operation type's configuration must set `allow_rollback`. `cancel` does not, because
  cancellation is customer-visible and terminal — a subscriber re-subscribes instead.
- The batch must have executed, and must not already be rolled back.
- An atomic batch that failed has no snapshot: it committed nothing, so there is nothing
  to reverse.
- A batch that touches the same subscription twice snapshots it only once, so rollback
  restores the state from before the whole batch rather than from mid-batch.

Rolling back also discounts the batch's successful items from analytics, so the reported
success rate reflects what actually stuck.

On the client, `batchStore.rollbackBatch()` walks the committed items and calls the
registered `RollbackHandler` for each — the compensating action is caller-supplied, since
only the caller knows how to refund a charge or delete a subscription. A rollback that
cannot reverse every item leaves the batch `partial` rather than claiming a clean
reversal.

```ts
useBatchStore.getState().setRollbackHandler(async (item, operationType) => {
  if (operationType === 'charge') return refundCharge(item.subscriptionId);
  if (operationType === 'create') return deleteSubscription(item.subscriptionId);
  return { success: false, error: `no compensating action for ${operationType}` };
});

const rollback = await useBatchStore.getState().rollbackBatch();
// { attempted: 12, reverted: 12, failed: 0 }
```

## Configuration per operation type

Limits differ by risk, so each operation type is configured independently.

| Field                          | `create` | `update` | `charge` | `cancel` |
| ------------------------------ | -------- | -------- | -------- | -------- |
| `maxItems`                     | 100      | 100      | 50       | 50       |
| `chunkSize` (client only)      | 50       | 50       | 25       | 25       |
| `atomicDefault`                | false    | false    | **true** | false    |
| `allowRollback`                | true     | true     | true     | **false**|
| `maxRetries` (client only)     | 3        | 3        | 2        | 1        |
| `idempotent` (client only)     | false    | true     | true     | true     |

Money movement defaults to atomic so a merchant never half-bills a cohort. Cancellation
keeps small batches and is not reversible. Creates are never deduplicated because two
subscriptions may legitimately share a name.

On-chain, `set_batch_config(caller, operation_type, config)` is admin-only and cannot
raise `max_items` above the hard ceiling of 100. `get_batch_config(operation_type)` falls
back to `default_config` for types that were never configured.

On the client, `batchStore.setOperationConfig(type, patch)` patches a single type,
`resetOperationConfig(type)` restores its defaults, and both are persisted. A draft is
validated against the active config before execution, and an oversized batch is rejected
without applying a single item:

```ts
const validation = useBatchStore.getState().validateDraft();
// { valid: false, reason: 'A charge batch is limited to 50 items (got 80).' }
```

## Idempotency and retry

The client service tracks the `(operation, subscriptionId)` pairs it has applied. When an
operation type is configured `idempotent`, re-submitting the same batch skips those items
with `status: 'skipped'` instead of double-charging. Successes discarded by an atomic
rollback are removed from that ledger, so a corrected re-run applies them normally.

`retryFailedItems(retryFn)` re-attempts only failed items, honouring the operation type's
`maxRetries` with exponential backoff (`retryDelayMs * backoffMultiplier ^ retryCount`).
Items that exhaust their budget are left failed rather than retried forever.

## Analytics

`computeBatchAnalytics(history)` derives, overall and per operation type:

- `batches`, `completed`, `partial`, `failed`, `rolledBack`
- `totalItems`, `successfulItems`, `failedItems`, `skippedItems`
- `batchSuccessRate` — fraction of batches that completed with no failures
- `itemSuccessRate` — fraction of individual items that succeeded
- `totalDurationMs`, `avgDurationMs`, `p95DurationMs`
- `avgItemDurationMs` and `throughputPerSecond`

Only batches that recorded a duration contribute to timing statistics, so history
persisted before timing existed cannot skew the averages. `useBatchStore().analytics()`
computes this from the store's persisted history; `service.getAnalytics()` reads the
service-level history in `AsyncStorage`.

On-chain, `get_batch_analytics()` and `get_batch_analytics_for(operation_type)` return the
same aggregates maintained incrementally as batches execute, with `success_rate_bps` in
basis points (`10_000` == 100%) and durations in ledger seconds.

## Gas model

Both layers use the same estimate: a fixed base of 50,000 plus a per-item cost (100,000 by
default, configurable per operation type on-chain via `gas_per_item`).

```
50 items batched : 50,000 + 50 × 100,000 = 5,050,000
50 items separate: 50 × 150,000          = 7,500,000
saving           : 2,450,000 (32%)
```

`calculateBatchGasSavings(itemCount, singleTransactionGas)` returns this comparison for
display.

## CSV input and result export

Each operation type accepts a CSV, parsed with quote-aware splitting and case-insensitive
headers:

- **create** — `name,description,category,price,currency,billingCycle,nextBillingDate,isActive,notificationsEnabled`
- **update** — `subscriptionId`
- **cancel** — `subscriptionId,reason,notes`
- **charge** — `subscriptionId,amount` (`id` and `price` are accepted aliases)

Rows without a name (create) or subscription id (others) are skipped rather than failing
the whole import. Results export as JSON (`exportBatchResultToJson`) or per-item CSV
(`exportBatchResultToCsv`) including status, error, retry count and per-item duration.

## Memory and large batches

Items are applied in chunks of `chunkSize`, bounding peak memory regardless of batch size.
The operator can override the chunk size live from the Options section of the batch screen;
that choice wins over the stored per-operation default.

## Testing

```bash
# Contract
cd contracts && cargo test -p subtrackr-batch

# Client service and store
npx jest --testPathIgnorePatterns "/node_modules/" --testPathPattern "app/(services|stores)/__tests__/batch"
```

Note that `app/` is excluded from the default `jest.config.js` `testPathIgnorePatterns`, so
these suites need the override above to run.
