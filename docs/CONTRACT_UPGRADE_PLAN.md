# Contract Upgradeability Plan

> Issue #1809 — Storage/upgrade risks are unmanaged. This document is the
> authoritative upgradeability plan for the SubTrackr Soroban contracts: the
> versioning scheme, the step-by-step migration procedure, rollback/emergency
> procedures, and the tests that guard them.

## 1. Architecture

SubTrackr uses the **proxy + storage + implementation** pattern:

| Contract | Crate | Role |
|----------|-------|------|
| `UpgradeableProxy` | `contracts/proxy` | Single permanent on-chain address clients call. Holds the active implementation pointer, the storage contract pointer, the proxy version, the upgrade timelock, and the upgrade history. |
| `SubTrackrStorage` | `contracts/storage` | Owns all durable state (instance + persistent + temporary). Only the *authorised implementation* may write; reads are public. |
| `SubTrackrSubscription` | `contracts/subscription` | The implementation. Business logic + the `get_version` / `validate_upgrade` / `migrate` upgrade hooks. |

Because state lives in `SubTrackrStorage` (not the implementation), the
implementation can be replaced without losing data. The proxy enforces a
timelock and runs compatibility checks + migrations before switching the
pointer.

## 2. Versioning scheme

- Every implementation declares a `STORAGE_VERSION: u32` constant
  (`contracts/subscription/src/lib.rs`, currently `2`).
- The proxy stores its own `ProxyVersion` (in proxy instance storage), which
  tracks the last-known implementation version. During `initialize` the proxy
  adopts the implementation's `STORAGE_VERSION` as its baseline.
- A version bump is **required** whenever the storage layout changes:
  - New `StorageKey` variants are introduced, **or**
  - An existing key's encoding/semantics change, **or**
  - A derived index (e.g. `UserPlanIndex`) is added that must be back-filled.
- Versions are **monotonic**: `upgrade_to` rejects a target whose
  `get_version` is below the current proxy version
  (`assert!(target_version >= current_version, "Target version behind current")`).

### Storage version history

| Version | What changed | Migration (`migrate(from_version)`) |
|---------|--------------|--------------------------------------|
| 1 | Initial layout (plans, subscriptions, counts) | — |
| 2 | Added `UserPlanIndex(Address, u64)` derived index | `from_version == 1`: iterate non-cancelled subscriptions and rebuild `UserPlanIndex` |
| 3+ | (reserved) | Add a new `if from_version == N { … }` arm; never edit a past arm |

### Rules for authoring a new version

1. Bump `STORAGE_VERSION` by **1** (never skip).
2. Add any new `StorageKey` variants **at the end** of the enum — never
   reorder or reuse an existing discriminant.
3. Add a `from_version == N` arm to `migrate` that back-fills derived state.
   Never mutate an existing arm (past migrations must stay reproducible).
4. Keep `validate_upgrade` accepting every `from_version` in
   `1..=STORAGE_VERSION`; reject `0` and anything `> STORAGE_VERSION`.
5. If a change is **breaking** (renamed/removed key, changed encoding), do
   **not** bump in place — use the blue-green cutover in §5 instead.

## 3. Upgrade procedure (in-place, via the proxy)

A normal upgrade goes through the proxy's timelocked `schedule → execute`
flow. All steps require the stored admin's auth.

```
            ┌─────────────┐
            │  authorise  │  admin calls authorize_upgrade(new_impl)
            └──────┬──────┘
                   ▼
            ┌─────────────┐
            │   schedule  │  proxy.schedule_upgrade(impl, now + delay)
            │  (timelock) │  recorded in ProxyScheduledUpgrade + history
            └──────┬──────┘
                   │  wait ≥ upgrade_delay_secs
                   ▼
            ┌─────────────┐
            │  upgrade_to │  admin calls upgrade_to(impl)
            └──────┬──────┘
                   ▼
   ┌────────────────────────────────────────────────┐
   │ 1. storage.set_implementation(new_impl)         │
   │ 2. get_version(new_impl) → target_version       │
   │ 3. validate_upgrade(new_impl, current_version)  │  ← compatibility gate
   │ 4. if target_version > current:                 │
   │      migrate(new_impl, current_version)         │  ← back-fill
   │      proxy.set_version(target_version)          │
   │ 5. clear scheduled upgrade; append history      │
   └────────────────────────────────────────────────┘
```

### Preconditions

- The new implementation is deployed and exposes `get_version`,
  `validate_upgrade`, and `migrate` with the proxy/storage signature.
- `get_version(new_impl) >= proxy.get_version()`.
- No upgrade is already scheduled (cancel it first if needed).

### Cancellation

`cancel_scheduled_upgrade()` clears a pending upgrade any time before
`upgrade_to` executes. The history records the cancellation.

## 4. Rollback & emergency procedures

- `rollback()` schedules a return to the **immediately-previous**
  implementation (tracked on a previous-implementation stack), subject to the
  rollback timelock (`rollback_delay_secs`).
- Rollback does **not** re-run `migrate` and does **not** revert storage
  writes. It is safe when the previous implementation can read the current
  storage version (i.e. the upgrade did not change the layout, or the previous
  implementation was forward-compatible). For layout-breaking changes use the
  blue-green cutover in §5.
- After a rollback, the previous-implementation stack is swapped (not popped)
  so an operator can "roll forward" again if the rollback itself misbehaves.
- Every schedule / execute / cancel / rollback is appended to
  `ProxyUpgradeHistory` (queryable via `get_upgrade_history_count` /
  `get_upgrade_history_entry`) for auditing.

## 5. Blue-green cutover (layout-breaking changes)

For changes that cannot be migrated in place (renamed/removed keys, changed
encoding), use the operational cutover in `contracts/migrations/`:

1. **Snapshot** — export plans + subscriptions from the source contract
   (`contracts/migrations/lib.sh`).
2. **Deploy** — deploy + initialize a replacement contract + storage pair.
3. **Rehydrate** — load the snapshot into the replacement.
4. **Validate** — run read-side checks against the replacement.
5. **Cutover** — switch the application's active `CONTRACT_ID` pointer only
   after validation passes.
6. **Rollback** — restore the previous `CONTRACT_ID` if the replacement
   misbehaves.

See `contracts/migrations/README.md` and `001_blue_green_cutover.sh`.

## 6. Test coverage

The upgrade path is guarded by two test files:

### `contracts/proxy/tests/upgrade_flow.rs`

Proxy-level lifecycle with mock V1/V2 implementations:

- `upgrade_flow_preserves_state_and_enforces_timelocks` — state survives an
  upgrade; the timelock is enforced; the version advances.
- `upgrade_validation_failure_does_not_change_implementation` — a failing
  `validate_upgrade` aborts the switch and leaves the pointer/version intact.

### `contracts/subscription/tests/upgrade_versioning.rs` (new)

Real-contract versioning hooks against the actual `SubTrackrSubscription` +
`UpgradeableProxy` + `SubTrackrStorage` trio (no mocks):

- `get_version_reports_current_storage_version`
- `validate_upgrade_accepts_current_and_prior_versions` (v1, v2)
- `validate_upgrade_rejects_zero_and_future_versions` (0, v3)
- `migrate_is_a_noop_when_already_at_current_version`
- `migrate_rejects_unsupported_future_path`
- `migrate_v1_to_v2_rebuilds_user_plan_index_for_active_only` — drops the
  `UserPlanIndex` to simulate a v1 snapshot, runs `migrate(1)`, and asserts
  the index is rebuilt for active subscriptions **only** (cancelled ones are
  skipped).
- `proxy_version_tracks_implementation_version_after_initialize`

Run locally:

```bash
cargo test --manifest-path contracts/subscription/Cargo.toml --test upgrade_versioning
cargo test --manifest-path contracts/proxy/Cargo.toml --test upgrade_flow
```

## 7. Acceptance criteria

- [x] **Versioning** — `STORAGE_VERSION` constant + `ProxyVersion` proxy
      storage; monotonic upgrades enforced; per-version migration arms.
- [x] **Migration steps** — §3 in-place flow (schedule → timelock → validate
      → migrate → version bump) and §5 blue-green cutover for breaking
      changes; rollback in §4.
- [x] **Tested** — `upgrade_flow.rs` (proxy lifecycle) + `upgrade_versioning.rs`
      (real-contract versioning, compatibility gates, and v1→v2 migration).
