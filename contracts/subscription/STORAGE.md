# Contract Storage Strategy & Transient Storage Refactor

This document records the storage access-pattern analysis for the SubTrackr
subscription contract and the criteria used to pick a storage type for each
piece of state. It is the reference for the gas-optimization work that moved
short-lived state out of persistent/instance storage and into **transient
(temporary) storage**.

## 1. Soroban storage types

Soroban exposes three storage durabilities. Each has a different cost and
lifetime profile:

| Type | Lifetime | Rent | Best for |
|------|----------|------|----------|
| `instance()` | Tied to the contract instance; shares one TTL with the contract | Bundled with the contract instance TTL; read on **every** invocation | Small, hot, contract-wide config (admin, counters, linked-contract addresses) |
| `persistent()` | Survives indefinitely while rent is paid; independently archivable | Per-entry rent, must be bumped to avoid archival | Durable business records that must outlive a transaction (subscriptions, plans, invoices, webhooks) |
| `temporary()` | Auto-expires after an explicit TTL (in ledgers); cannot be restored once expired | Cheapest; no long-term rent | Short-lived, reconstructible, intermediate state |

Reference: ledger close time ≈ 5 s on mainnet, so:

```
60 s ≈ 12 ledgers   1 h ≈ 720 ledgers   1 day ≈ 17 280 ledgers
```

`secs_to_ledgers()` in `lib.rs` converts a duration to a ledger TTL.

## 2. Storage type selection criteria

Pick the **cheapest** durability that still satisfies the data's lifetime and
recoverability needs. Apply the checklist top-to-bottom; the first match wins:

1. **Does it need to be readable on every invocation, and is it tiny and
   contract-wide?** → `instance`. (e.g. `Admin`, `PlanCount`,
   `OracleContract`.) Keep this set small — instance storage is read on every
   call and inflates the base fee.

2. **Must it survive indefinitely and be authoritative business state that
   cannot be recomputed?** → `persistent`. (e.g. `Subscription`, `Plan`,
   `Invoice`, `Webhook`, `WebhookDelivery`, `CreditMemo`.) Losing it would lose
   money or audit history.

3. **Is it short-lived, reconstructible, or only meaningful for a bounded
   window — and is auto-expiry acceptable (or desirable) behaviour?** →
   `temporary`. This covers:
   - rate-limit timestamps (valid only for one rate-limit window),
   - charge-state-machine guards / nonces (valid for one ledger),
   - pending operations with a deadline (transfer offers),
   - intermediate calculations (proration previews).

If expiry of a value would cause **silent financial loss or corruption**, it is
NOT a candidate for transient storage — use persistent instead.

## 3. Access-pattern analysis & decisions

| State | Key | Before | After | Rationale |
|-------|-----|--------|-------|-----------|
| Rate-limit timestamps | `TmpLastCall(caller, fn)` | instance | **transient** (TTL = rate-limit window) | Only needs to live for `min_secs`; auto-expiry frees the entry and avoids unbounded one-per-(caller,fn) growth. |
| Charge dedup nonce | `TmpChargeNonce(sub_id)` | n/a | **transient** (TTL = 1 ledger) | A charge must happen at most once per ledger; the guard is intermediate state that should self-clear on the next ledger. |
| Pending transfer offer | `TmpPendingTransfer(sub_id)` | instance (`PendingTransfer`) | **transient** (TTL = 7 days) | A transfer offer is a *pending operation* + *temporary authorization*. It should expire if not accepted instead of persisting and accruing rent forever. |
| Proration preview | `TmpProrationScratch(sub_id)` | n/a | **transient** (TTL = 1 billing interval) | A previewed amount is an intermediate calculation only relevant until the change is confirmed or abandoned. |
| Subscriptions / Plans / Invoices / Webhooks / Credit memos | various | persistent | **persistent** (unchanged) | Authoritative records that must outlive transactions and be archival-safe. |
| Admin / counters / linked contracts | `Admin`, `*Count`, `OracleContract`, … | instance | **instance** (unchanged) | Small, contract-wide, read on most calls. |

### Data-consistency notes when mixing storage types

- **Never** read a `Tmp*` key from `instance`/`persistent` or vice-versa — a
  durability mismatch returns `None`. The `Tmp` prefix on every transient key
  makes the intended durability explicit at the call site.
- Transient reads must always tolerate `None` (expired/never-written) and treat
  it as the safe default (e.g. "no pending transfer", "not rate-limited",
  "no cached preview"). The contract code does this everywhere it reads a
  `Tmp*` key.
- **Migration:** the rate-limit refactor (Issue #395) intentionally ignores any
  legacy instance-backed `LastCall` entries; worst case a caller gets one extra
  call immediately after upgrade, then the limit re-applies. The transfer
  refactor likewise reads only `TmpPendingTransfer`; any in-flight legacy
  `PendingTransfer` offer would need to be re-requested after upgrade.
- TTLs are sized from the data's real lifetime via `secs_to_ledgers()`, with a
  floor of 1 ledger so nothing is written already-expired.

## 4. Benchmarking gas before/after

Use the in-repo gas profiler to compare costs around the refactor:

```bash
# Build the optimized wasm
cd contracts && cargo build --release --target wasm32-unknown-unknown -p subtrackr-subscription

# Measure per-function resource usage with the gas profiler module
#   (see contracts/subscription/src/gas_profiler.rs and gas_storage.rs)
```

Expected directional results (transient vs the persistent/instance baseline):

- **Rate-limited functions** (`charge_subscription`, `request_refund`, …):
  lower instance-storage footprint → smaller per-invocation base fee, and no
  long-term rent for last-call timestamps.
- **`request_transfer` / `accept_transfer`**: pending-transfer entries no longer
  accrue persistent rent; offers self-expire.
- **`charge_subscription`**: one extra cheap transient read+write for the nonce
  guard, traded for double-charge protection within a ledger.

Record concrete `cpu_insns` / `mem_bytes` / rent figures from the profiler in
the PR description when running on a target network, since absolute numbers
depend on the network's fee schedule.

## 5. Adding new state — quick rule

> Default to `temporary` for anything short-lived or recomputable; reach for
> `persistent` only when the value is authoritative and must survive; reserve
> `instance` for tiny contract-wide config read on most calls.
