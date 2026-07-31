# Smart Contract Gas Optimization

## Storage Slot Analysis

Soroban has three storage tiers. Each tier has a different cost profile:

| Tier | Lifetime | Fee model | Suitable for |
|------|----------|-----------|--------------|
| `instance` | Contract lifetime | Charged on **every invocation** | Tiny, hot, contract-wide config |
| `persistent` | Until rent expires | Per-entry rent, must be bumped | Durable business records |
| `temporary` | Auto-expires after TTL | **Cheapest** — no long-term rent | Short-lived, reconstructible state |

### Storage slot packing analysis

The `SubTrackr` subscription contract minimizes the instance storage footprint
(which is loaded on every call) to exactly the fields that are read on most
invocations:

| Key | Tier | Bytes (approx.) | Read frequency |
|-----|------|-----------------|----------------|
| `Admin` | instance | 32 | Every privileged call |
| `PlanCount` | instance | 8 | create_plan, queries |
| `SubscriptionCount` | instance | 8 | subscribe, queries |
| `InvoiceContract` | instance | 33 (option) | charge_subscription |
| `OracleContract` | instance | 33 (option) | charge_subscription |
| `MaxPlansPerMerchant` | instance | 4 | create_plan |
| `LargeChargeThreshold` | instance | 16 | reveal_charge |
| `AccessControl` | instance | 33 (option) | permission checks |
| `RateLimit(fn)` | instance | 8 × N functions | every rate-limited call |

**Total hot instance storage: ~175 bytes** for a fully configured deployment.

Entries moved **out** of instance storage (Issue #395):

| Old Key | Old Tier | New Key | New Tier | Savings |
|---------|----------|---------|----------|---------|
| `LastCall(addr, fn)` | instance | `TmpLastCall(addr, fn)` | temporary | ~40 bytes × N callers |
| `PendingTransfer(id)` | instance | kept as instance | instance | — |

---

## Lazy Initialization for Optional Data

Optional contracts (oracle, invoice, access control) are stored as `Option<Address>`
in instance storage. Functions that don't need them skip the read entirely:

```rust
// Fast path: only read oracle when needed
let oracle_opt: Option<Address> =
    storage_instance_get(env, storage, StorageKey::OracleContract);
if oracle_opt.is_none() || bounds_opt.is_none() {
    return plan.price;  // ← skip oracle logic, save ~2 cross-contract calls
}
```

The `invoice_contract()` helper similarly returns `None` for deployments that
haven't linked an invoice contract, avoiding the generate_invoice call.

---

## Gas-Optimized Data Structures

### `UserPlanIndex` — O(1) duplicate detection

Before (O(N) scan):
```rust
// Had to iterate all user subscriptions to check for duplicates
for sub_id in user_subs.iter() {
    let sub = get_subscription(sub_id);
    if sub.plan_id == plan_id && sub.status != Cancelled { panic!("already subscribed") }
}
```

After (O(1) lookup):
```rust
// Direct index lookup — one persistent read
if let Some(existing_id) = get_user_plan_index(env, storage, &subscriber, plan_id) {
    let existing_sub = get_subscription(existing_id);
    if existing_sub.status != Cancelled { panic!("already subscribed") }
}
```

Saves approximately `N × persistent_read_cost` per subscribe call where N is the
number of existing subscriptions for that user.

### `TmpChargeNonce` — double-charge guard without persistent cost

```rust
// Stored in temporary storage (TTL = 1 ledger ≈ 5 s)
// Auto-expires; no explicit delete required
storage_temporary_set(env, storage,
    StorageKey::TmpChargeNonce(subscription_id), now, 1);
```

### `TmpLastCall` — rate-limit without unbounded instance growth

Each (caller, function_name) pair no longer adds a permanent entry to instance
storage. Instead it uses temporary storage with TTL = `min_interval_secs`.
In steady state (after all windows expire), instance storage contains **zero**
rate-limit entries.

---

## Gas Benchmarks

Run benchmarks locally:

```bash
# Quick run — all gas_benchmark_* tests with stdout
cargo test -p subtrackr-subscription gas_benchmark -- --nocapture

# Full pipeline with regression check and SVG chart
bash scripts/gas-benchmark.sh

# Generate/reset the baseline snapshot
bash scripts/gas-benchmark.sh --generate-baseline
```

### Function targets (CPU instructions)

| Function | Target | Category |
|----------|--------|----------|
| `initialize` | 25 000 | write |
| `create_plan` | 75 000 | write |
| `subscribe` | 65 000 | write |
| `charge_subscription` | 150 000 | transfer |
| `cancel_subscription` | 45 000 | write |
| `pause_subscription` | 35 000 | write |
| `resume_subscription` | 40 000 | write |
| `request_refund` | 30 000 | write |
| `approve_refund` | 35 000 | write |
| `request_transfer` | 25 000 | write |
| `accept_transfer` | 85 000 | complex |
| `get_plan` | 15 000 | read |
| `get_subscription` | 15 000 | read |
| `get_user_subscriptions` | 20 000 | read |

Regressions > 10% vs. baseline fail CI.

---

## Gas Regression Testing in CI

The `.github/workflows/performance-ci.yml` workflow runs:

1. `gas-benchmarks` job — runs `bash scripts/gas-benchmark.sh` on every PR
2. Compares against the cached `gas-benchmarks/baseline.json`
3. Fails the job if any function exceeds baseline by >10%
4. Posts a summary table as a PR comment
5. Uploads `gas_trend.svg` for visual trend tracking over time
6. The baseline is persisted via GitHub Actions cache keyed on `contracts/**/*.rs` hash

---

## Gas Comparison: Before vs. After Optimizations

### Rate-limit enforcement (Issue #395)

| Metric | Before (instance storage) | After (temporary storage) | Reduction |
|--------|--------------------------|---------------------------|-----------|
| Instance entries (10 callers) | 10 permanent | 0 (steady state) | 100% |
| Instance storage fee per call | ~10 000 instructions | ~0 | ~100% |
| Write cost per new caller | ~1 000 instructions | ~800 instructions | ~20% |
| Long-term rent | ∞ (never expires) | 0 (auto-expires) | 100% |

### UserPlanIndex (O(1) duplicate check)

| Metric | Before (O(N) scan) | After (O(1) index) |
|--------|--------------------|--------------------|
| subscribe() reads (5 existing subs) | 6 | 2 |
| subscribe() reads (50 existing subs) | 51 | 2 |
| Estimated instruction savings (50 subs) | — | ~49 × 12 000 = 588 000 |

### Lazy optional contract reads

| Scenario | Before | After |
|----------|--------|-------|
| charge (no oracle configured) | reads oracle + bounds | reads oracle → None → skip |
| charge (no invoice contract) | tries to call invoice | reads invoice_contract → None → skip |
| Estimated savings per charge (no oracle) | — | ~2 cross-contract call overheads |
