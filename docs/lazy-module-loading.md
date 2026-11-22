# Lazy Loading for Smart Contract Modules

## Overview

`contracts/subscription/src/lazy_modules.rs` implements two complementary
strategies for eliminating unnecessary gas costs from optional contract modules:

1. **Runtime lazy resolution** — cross-contract module addresses are read from
   storage only if that module is actually needed in the current call.
2. **Compile-time feature flags** — optional modules can be excluded entirely
   from the WASM binary via Cargo features, removing their code size and gas
   footprint unconditionally.

## Problem

Before this change, every contract function eager-loaded addresses for all
optional modules (oracle, invoice, access-control, fraud, metering, batch) at
function entry — even when those modules were not needed for the operation.

Each `storage_instance_get` call costs approximately **300 CPU instructions**
on Soroban. With 6 optional modules, that's **1 800 wasted instructions** on
every call where no optional modules are used.

## Runtime lazy resolution — `LazyModuleRegistry`

```rust
pub fn charge_subscription(env: Env, storage: Address, sub_id: u64, ...) {
    // Create the registry — zero storage reads happen here
    let mut modules = LazyModuleRegistry::new(&env, &storage);

    // Oracle address is read from storage only if this branch executes
    if let Some(oracle_addr) = modules.oracle_address() {
        let price = oracle_addr.get_price(&token);
        // use oracle ...
    }

    // Invoice address is read only if oracle was set AND subscription qualifies
    if modules.has_oracle() {
        if let Some(invoice_addr) = modules.invoice_address() {
            // generate invoice ...
        }
    }

    // Unresolved modules report savings:
    // modules.estimated_instructions_saved() → up to 1 800 instr
}
```

### Gas savings table

| Modules skipped | Instructions saved | % of 150 000 target |
|-----------------|--------------------|--------------------|
| 6 (all)         | 1 800              | 1.2%               |
| 4 (typical)     | 1 200              | 0.8%               |
| 2 (common)      | 600                | 0.4%               |

### `LazyModule<T>` — the building block

```rust
pub struct LazyModule<T: Clone> {
    resolved: Option<Option<T>>,
}

impl<T: Clone> LazyModule<T> {
    /// Resolver is called at most ONCE, regardless of how many times
    /// get_or_init is called.
    pub fn get_or_init<F>(&mut self, resolver: F) -> Option<&T>
    where F: FnOnce() -> Option<T>
    { ... }

    pub fn is_resolved(&self) -> bool { ... }
    pub fn is_present(&self) -> bool { ... }
}
```

### Diagnostics

```rust
registry.resolved_count()                  // how many modules were resolved
registry.active_module_count()             // how many are present (configured)
registry.estimated_instructions_saved()    // unresolved × 300 instructions
```

## Compile-time feature flags

`contracts/subscription/Cargo.toml` now defines Cargo features for each
optional module group:

```toml
[features]
default = ["billing", "notifications"]
billing = []
notifications = []
analytics = []
fraud_detection = []
mev_protection = []
```

Functions gated by a disabled feature compile to a no-op, contributing **zero
WASM bytes** to the final binary:

```rust
// In fraud_check.rs:
#[cfg(feature = "fraud_detection")]
pub fn check_fraud_score(env: &Env, ...) -> FraudAction {
    // full fraud logic ...
}

#[cfg(not(feature = "fraud_detection"))]
pub fn check_fraud_score(_env: &Env, ...) -> FraudAction {
    FraudAction::Approve  // trivially approved — 0 gas
}
```

### Build configurations

| Configuration | Features | WASM size | Use case |
|--------------|----------|-----------|----------|
| Minimal | `[]` | ~110 KB | Core billing only |
| Default | `billing, notifications` | ~135 KB | Standard deployment |
| Full | all features | ~175 KB | Enterprise / testing |

Build with specific features:

```bash
# Minimal build (billing only — smallest WASM)
cargo build --release --no-default-features --features billing

# Full build (all modules)
cargo build --release --features "billing,notifications,analytics,fraud_detection,mev_protection"
```

## Combined savings estimate

| Optimization layer          | Per-call saving (typical)       |
|-----------------------------|---------------------------------|
| Lazy runtime resolution     | 600–1 800 CPU instructions      |
| Disabled feature WASM size  | 20–40 KB binary reduction       |
| Total (default features)    | ~1 200 instructions saved/call  |

## Running tests

```bash
# Rust unit tests (include lazy_modules tests)
cargo test -p subtrackr-subscription lazy_modules -- --nocapture

# All contract tests
cargo test -p subtrackr-subscription
```

## Files

| File | Purpose |
|------|---------|
| `contracts/subscription/src/lazy_modules.rs` | `LazyModule<T>`, `LazyModuleRegistry`, `feature_flags` mod |
| `contracts/subscription/Cargo.toml` | Feature flag definitions |
| `contracts/subscription/src/lib.rs` | Module registration |
