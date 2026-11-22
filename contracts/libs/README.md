# Reusable Soroban contract libraries

This directory hosts `rlib`-only crates shared by SubTrackr contracts. They contain
no contract entry points and produce no WASM artifacts, so existing contract ABIs
and deployment targets are unchanged.

| Crate | Purpose |
|---|---|
| `subtrackr-billing-math` | Proration, period arithmetic and tiered fees |
| `subtrackr-storage-core` | Storage tier access and TTL policy |
| `subtrackr-security-core` | Reentrancy lock for cross-contract calls |

The crates are workspace members. Add a path dependency from a contract crate when
adopting one of them:

```toml
[dependencies]
subtrackr-billing-math = { path = "../libs/subtrackr-billing-math" }
```

Run their tests with `cargo test --workspace` from `contracts/`.
