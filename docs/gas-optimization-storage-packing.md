# Smart Contract Gas Optimization — Storage Packing

## Summary

`contracts/subscription/src/storage_packing.rs` introduces packed storage
layouts that combine multiple individual `StorageKey` entries into single
composite structs. This reduces per-call Soroban storage fees and CPU
instruction counts.

## Background

Soroban charges fees per storage **entry**, not per byte. Grouping related
fields that are always read/written together into one struct means one fee
instead of N fees. The hot-path instance storage is especially important
because it is loaded on **every contract invocation**.

## Packed types

### `HotConfigPack` (instance storage)

Replaces 9 individual instance-storage entries with one packed struct:

| Replaced key           | Bytes (approx.) |
|------------------------|-----------------|
| `Admin`                | 32              |
| `PlanCount`            | 8               |
| `SubscriptionCount`    | 8               |
| `MaxPlansPerMerchant`  | 4               |
| `LargeChargeThreshold` | 16              |
| `InvoiceContract`      | 33              |
| `OracleContract`       | 33              |
| `AccessControl`        | 33              |
| `StorageVersion`       | 4               |
| **Total**              | **~175 bytes**  |

Estimated savings per call: **≥ 2 400 CPU instructions** (8 avoided reads × 300 instr each).

### `SubscriptionPack` (persistent storage)

All mutable subscription state in one entry. Fields that change together
on `charge_subscription` (timestamp, total_paid, charge_count) are colocated
so a single read + write services the whole operation.

### `PlanPack` (persistent storage)

All mutable plan state in one entry. Uses a compact `interval_bits: u8`
instead of the full `Interval` enum serialisation.

### `RateLimitPack` (temporary storage)

Combines `min_interval_secs` + `last_call_at` + call counters into one
**temporary** entry keyed by `(caller_address, function_name)`. The entry
auto-expires with TTL = `min_interval_secs` so in steady state instance
storage contains zero rate-limit entries.

## Storage key extensions

`PackedStorageKey` adds new variants alongside (not replacing) the existing
`StorageKey` enum to maintain backward compatibility:

```rust
PackedStorageKey::HotConfig           // instance — one entry for 9 fields
PackedStorageKey::SubPack(sub_id)     // persistent — full subscription state
PackedStorageKey::PlanPack(plan_id)   // persistent — full plan state
PackedStorageKey::RateLimitPack(addr, fn_name)  // temporary — rate-limit data
PackedStorageKey::ChargeNonce(sub_id) // temporary — double-charge guard
PackedStorageKey::MevConfigPack       // instance — MEV config + alert count
```

## Gas savings analysis

```
StoragePackingAnalysis::bytes_saved_per_call()        → ≥ 162 bytes per call
StoragePackingAnalysis::instructions_saved_per_call() → 2 400 instructions per call
```

At 1 000 calls/day, 2 400 saved instructions × 1 000 = **2.4 M instructions/day**
that are not charged to the contract operator.

## Running storage packing tests

```bash
cargo test -p subtrackr-subscription storage_packing -- --nocapture
```

## Migration guide

1. Deploy the new contract version.
2. On first invocation by admin, call `migrate_to_packed_storage()` (to be
   implemented in the migration module) which reads legacy individual keys and
   writes them as a single `HotConfigPack`.
3. After migration, legacy keys can be removed to reclaim rent.

See also: `contracts/subscription/STORAGE.md`, `GAS_OPTIMIZATION.md`.
