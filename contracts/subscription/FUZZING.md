# Subscription Contract Fuzzing

SubTrackr uses coverage-guided fuzzing for the subscription lifecycle, pricing, and rate-limit surfaces. The fuzz harnesses live in `contracts/fuzz` and execute the real Soroban proxy, storage, token, and subscription contracts in a test environment.

## Targets

| Target | Focus |
| --- | --- |
| `subscription_lifecycle` | Plan creation, subscribe, pause, resume, cancel, charge, refund, and core subscription invariants |
| `subscription_pricing` | Price boundaries, interval combinations, repeated charges, and accounting invariants |
| `subscription_rate_limits` | Rate-limit configuration and repeated protected operations |

Each target starts from seed corpus files in `contracts/fuzz/corpus/<target>/`. CI also adds a generated seed per run so target-specific corpora are never empty.

## Run Locally

Install nightly Rust and `cargo-fuzz`:

```bash
rustup toolchain install nightly
cargo +nightly install cargo-fuzz --locked
```

Run the deterministic smoke replay:

```bash
cargo test --manifest-path contracts/subscription/Cargo.toml --test fuzz_smoke -- --nocapture
```

Run a fuzz target:

```bash
cd contracts
cargo +nightly fuzz run subscription_lifecycle fuzz/corpus/subscription_lifecycle -- -max_total_time=1800
```

Use the same pattern for `subscription_pricing` and `subscription_rate_limits`.

## CI

`.github/workflows/fuzz-test.yml` runs:

- The smoke replay test.
- `cargo fuzz list` to verify target registration.
- Each coverage-guided target for 1800 seconds by default.
- Corpus and crash artifact upload for triage.

The workflow runs on PRs and pushes touching contract or fuzzing files, weekly on a schedule, and manually with a configurable `fuzz_seconds` input.

## Crash Triage

When CI uploads a crash artifact:

```bash
cd contracts
cargo +nightly fuzz run subscription_lifecycle path/to/crash
cargo +nightly fuzz tmin subscription_lifecycle path/to/crash
```

The helper script copies a crash into a regression location and prints replay commands:

```bash
bash contracts/fuzz/scripts/triage-crash.sh subscription_lifecycle path/to/crash
```

Promote minimized crashes into deterministic tests under `contracts/subscription/tests/` by replaying the target logic against the saved bytes. Keep the original minimized crash file in `contracts/subscription/tests/regressions/` when the byte sequence matters.

## Adding Targets

1. Add a new `[[bin]]` entry in `contracts/fuzz/Cargo.toml`.
2. Create `contracts/fuzz/fuzz_targets/<target>.rs`.
3. Add at least one corpus seed under `contracts/fuzz/corpus/<target>/`.
4. Add the target to the workflow matrix.
5. Document the invariant and expected panic handling here.

Fuzz targets should catch expected contract panics for invalid user actions, then assert invariants after each successful or rejected operation. Unexpected invariant failures should remain crashes.
