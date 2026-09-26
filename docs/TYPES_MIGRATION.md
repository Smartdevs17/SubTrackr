# SubTrackr Shared Types — Migration Guide

**Issue #404 — Reorganize contract workspace with shared types crate**

---

## Overview

All data structures shared across contract crates live in `contracts/types/`.
Every contract crate re-exports these types from its own root:

```rust
// In contracts/subscription/src/lib.rs
pub use subtrackr_types::*;
```

Downstream clients (frontend SDK, indexers) should always import from the
contract crate they interact with, not directly from `subtrackr-types`, so
they remain decoupled from the workspace layout.

---

## Versioning policy

`TYPES_VERSION` in `contracts/types/src/lib.rs` is a `u32` constant embedded
in each contract's instance storage during initialization.

| Change type                              | Version bump? |
|------------------------------------------|:---:|
| New field (with a default / `Option`)    | No  |
| New enum variant appended at the end     | No  |
| Field removed or type changed            | **Yes** |
| Enum variant reordered or removed        | **Yes** |
| Struct renamed                           | **Yes** |

### How to detect a mismatch at runtime

```rust
// In your contract's migrate() entry-point:
let stored_version: u32 = env.storage().instance()
    .get(&StorageKey::TypesVersion)
    .unwrap_or(0);

if stored_version != subtrackr_types::TYPES_VERSION {
    panic!("types version mismatch: stored={} current={}",
        stored_version, subtrackr_types::TYPES_VERSION);
}
```

---

## Migration history

### v1 → initial release

All types were previously defined inline in each contract crate.  This version
consolidates them into `contracts/types/`.

**Steps to migrate a contract crate to use shared types:**

1. Remove the locally-defined type.
2. Add the dependency in `Cargo.toml`:
   ```toml
   [dependencies]
   subtrackr-types = { path = "../types" }
   ```
3. Replace the `use` at the file top:
   ```rust
   // Before (local definition removed):
   // pub struct Subscription { … }

   // After:
   use subtrackr_types::Subscription;
   ```
4. Run `cargo check` in the workspace root to confirm all crates compile.
5. Update `TYPES_VERSION` in `contracts/types/src/lib.rs` if this is a
   breaking change.

---

## Adding a new shared type

1. Add the struct / enum to `contracts/types/src/lib.rs`.
2. Derive `Clone`, `Debug`, `PartialEq`, and `#[contracttype]`.
3. Add a doc-comment explaining the field semantics.
4. Re-export it from any contract crate that uses it.
5. Write a serialization round-trip test in `contracts/types/tests/`.

---

## Circular dependency prevention

The `subtrackr-types` crate **must not** depend on any other workspace crate.
If a type needs to reference contract-specific logic, put that logic in the
contract crate and accept the type as a parameter.

CI enforces this via `cargo tree --invert subtrackr-types` in the `ci.yml`
workflow — any reverse dependency will fail the build.

---

## Serialization format

All types use `#[contracttype]` (Soroban XDR serialization).  Do not add
`serde` derives to shared types; the XDR encoding is the canonical on-chain
format.  If you need JSON for off-chain use, add a `#[cfg(feature = "serde")]`
gate in the crate feature flags.
