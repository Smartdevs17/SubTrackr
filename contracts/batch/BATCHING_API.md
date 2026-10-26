# SubTrackr Batch Contract API

Reference for the `subtrackr-batch` contract. For the end-to-end feature — client service,
store, UI, CSV import and export — see [`docs/BATCH_OPERATIONS.md`](../../docs/BATCH_OPERATIONS.md).

## Overview

The batch contract applies one operation kind across many subscriptions in a single
transaction, so a merchant pays one base fee instead of `n`. It provides an atomic
execution guarantee, an explicit status machine, post-commit rollback, per-operation-type
configuration, and success/timing analytics.

## Types

```rust
pub enum OperationType { Create, Charge, Update, Cancel }

pub struct BatchOperation {
    pub operation_type: OperationType,
    pub subscription_ids: Vec<u64>,
    /// params[i] is the scalar argument for subscription_ids[i]:
    /// initial price (Create), charge amount (Charge), new price (Update),
    /// cancel reason code (Cancel).
    pub params: Vec<i128>,
}

pub enum BatchState { Pending, Processing, Completed, PartiallyCompleted, Failed, RolledBack }

pub enum CancelReason { TooExpensive, NoLongerNeeded, FoundAlternative, PoorService, Other }
```

`Create` ignores a missing `params`. `Charge` and `Update` require one entry per
subscription. `Cancel` accepts either no entries (recording `Other` for every item) or one
per subscription.

## Functions

### Lifecycle

```rust
initialize(admin: Address)

create_batch_operation(owner, operation, atomic) -> Result<u64, BatchError>
create_batch_operation_default(owner, operation) -> Result<u64, BatchError>
execute_batch(batch_id) -> Result<BatchResult, BatchError>
rollback_batch(caller, batch_id) -> Result<BatchStatus, BatchError>
```

`create_batch_operation` validates the batch against the operation type's configured
`max_items` and returns a monotonic batch id. `create_batch_operation_default` uses the
operation type's `atomic_default` instead of an explicit flag.

`execute_batch` runs exactly once per batch; a second call returns
`BatchError::AlreadyExecuted`.

### Reads

```rust
get_batch_status(batch_id) -> BatchStatus      // state, counts, started_at, completed_at, duration
get_batch_result(batch_id) -> Option<BatchResult>
get_batch_history() -> Vec<u64>
get_batch_analytics() -> BatchAnalytics
get_batch_analytics_for(operation_type) -> BatchAnalytics
get_subscription(subscription_id) -> Option<SubscriptionRecord>
```

### Configuration

```rust
set_batch_config(caller, operation_type, config) -> Result<(), BatchError>  // admin only
get_batch_config(operation_type) -> BatchConfig

pub struct BatchConfig {
    pub max_items: u32,        // <= MAX_BATCH_ITEMS (100)
    pub atomic_default: bool,
    pub allow_rollback: bool,
    pub gas_per_item: u64,
}
```

Defaults (`default_config`):

| Operation | `max_items` | `atomic_default` | `allow_rollback` |
| --------- | ----------- | ---------------- | ---------------- |
| `Create`  | 100         | false            | true             |
| `Charge`  | 50          | **true**         | true             |
| `Update`  | 100         | false            | true             |
| `Cancel`  | 50          | false            | **false**        |

## Status machine

```
Pending ──▶ Processing ──▶ Completed              (no item failed)
                        ├▶ PartiallyCompleted     (some items failed, non-atomic)
                        └▶ Failed                 (atomic batch discarded its writes)

Completed / PartiallyCompleted ──▶ RolledBack
```

## Atomicity

An atomic batch stages writes in memory and flushes them only after the last item
succeeds. The first failure aborts the loop, the staging area is dropped, and the result
reports `rolled_back: true` with `successful_operations: 0`. A non-atomic batch commits
each success as it happens and finishes `PartiallyCompleted`.

## Rollback

`execute_batch` records a `SnapshotEntry { id, existed, prior }` for each subscription it
touched, capturing the state from before the batch. `rollback_batch` replays that snapshot:
entries with `existed: false` are removed, the rest are restored.

Rejections:

| Condition                                | Error                 |
| ---------------------------------------- | --------------------- |
| Caller is neither the owner nor the admin | `Unauthorized`        |
| Batch has not executed                   | `NotExecuted`         |
| Batch already rolled back                | `AlreadyRolledBack`   |
| Operation type sets `allow_rollback: false` | `RollbackNotAllowed`  |
| Atomic batch that committed nothing      | `RollbackNotAllowed`  |
| Unknown batch id                         | `BatchNotFound`       |

Rollback also discounts the batch's successful items from analytics.

## Analytics

```rust
pub struct BatchAnalytics {
    pub total_batches: u32,
    pub completed_batches: u32,
    pub partial_batches: u32,
    pub failed_batches: u32,
    pub rolled_back_batches: u32,
    pub total_items: u32,
    pub successful_items: u32,
    pub failed_items: u32,
    pub success_rate_bps: u32,   // 10_000 == 100%
    pub total_duration: u64,     // ledger seconds
    pub avg_duration: u64,
}
```

Maintained incrementally on every execution, globally and partitioned by operation type.

## Per-item results

```rust
pub struct OperationResult {
    pub subscription_id: u64,
    pub success: bool,
    pub code: u32,   // 0 on success, otherwise a CoreError discriminant
}
```

Common codes: `302` subscription not found, `311` already exists, `305` invalid amount,
`308` invalid price, `500` subscription not active, `501` already cancelled.

## Gas model

```
estimate = 50_000 + item_count * gas_per_item      // gas_per_item defaults to 100_000

5 items batched : 50_000 + 5 × 100_000 = 550_000
5 items separate: 5 × 150_000          = 750_000
saving          : 200_000 (26.7%)
```

## Events

| Topics                  | Data                                |
| ----------------------- | ----------------------------------- |
| `("batch", "created")`  | `batch_id`                          |
| `("batch", "executed")` | `(batch_id, successful, failed)`    |
| `("batch", "rolledbk")` | `batch_id`                          |

## Errors

```rust
pub enum BatchError {
    InvalidBatch = 1,
    AlreadyExecuted = 2,
    NotExecuted = 3,
    RollbackNotAllowed = 4,
    AlreadyRolledBack = 5,
    Unauthorized = 6,
    BatchNotFound = 7,
}
```

Each maps onto a `subtrackr_types::CoreError` for cross-contract propagation.

## Testing

```bash
cd contracts && cargo test -p subtrackr-batch
```
