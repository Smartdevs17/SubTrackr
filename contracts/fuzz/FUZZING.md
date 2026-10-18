# Fuzz Testing

This directory contains **coverage-guided fuzz targets** powered by
[`cargo-fuzz`](https://rust-fuzz.github.io/book/cargo-fuzz.html) (libFuzzer).

## Quick Start

```bash
# Prerequisite: nightly toolchain + cargo-fuzz
rustup install nightly
cargo install cargo-fuzz --locked

# Run all targets (CI does this for 30 min each)
cd contracts/fuzz

# Single target, quick smoke test (10 seconds)
cargo fuzz run subscription -- -max_total_time=10

# Full run (30 minutes)
cargo fuzz run pricing -- -max_total_time=1800
```

## Target Reference

| Target            | What it fuzzes                                    |
|-------------------|---------------------------------------------------|
| `subscription`    | Full lifecycle: create_plan → subscribe → charge → pause → resume → cancel |
| `pricing`         | Price boundary values, refund math, charge timing  |
| `rate_limit`      | Per-function rate-limit enforcement windows        |
| `state_machine`   | Illegal state transitions (double-cancel, charge-while-paused, etc.) |

## Byte Layout

Every target reads a flat `&[u8]` from libFuzzer and parses it as a
command stream. The first byte selects the action; remaining bytes are
action-specific parameters (prices, IDs, intervals). See the top comment
in each `fuzz_targets/<name>.rs` for the exact layout.

## Invariants Checked

After each fuzz action the 10 invariants from `contracts/tests/invariants/`
are verified:

1. `plan_count_monotonic` — PlanCount never decreases
2. `subscription_count_monotonic` — SubscriptionCount never decreases
3. `total_paid_conservation` — total_paid across subs sums correctly
4. `plan_subscriber_count_accuracy` — subscriber_count matches actual subs
5. `paused_at_non_zero_when_paused` — paused_at > 0 iff status is Paused
6. `cancelled_sub_not_chargeable` — cancelled subs can't be charged
7. `refund_amount_bounded` — refund_requested_amount ≤ total_paid
8. `next_charge_at_monotonic` — next_charge_at advances forward
9. `total_collected_non_negative` — total_collected ≥ 0
10. `user_subs_index_consistency` — every sub in UserSubscriptions exists

## Crash Triage

When a crash is found:

1. **Minimize** the crashing input:
   ```bash
   cargo fuzz tmin subscription <path/to/crash>
   ```

2. **Reproduce** with extra detail:
   ```bash
   RUST_BACKTRACE=1 cargo fuzz run subscription <minimized-crash>
   ```

3. **Classify** — is the crash:
   - A legitimate contract bug → fix + add regression test
   - A fuzz-target bug → fix the parser/state setup
   - Flaky (non-deterministic) → re-run with `-runs=100000` to confirm

4. **Add regression test**: Copy the minimized input to
   `.github/corpus/<target>/` so the corpus cache prevents regression.

## Configurable Iterations

Fuzz runs can be driven by **time** or by **iteration count**:

```bash
# Time-based (default): run each target for N seconds
cargo fuzz run subscription_lifecycle -- -max_total_time=1800

# Iteration-based: run exactly N inputs
cargo fuzz run subscription_lifecycle -- -runs=100000
```

In CI (`.github/workflows/fuzz-test.yml`), the `workflow_dispatch` trigger
exposes both:

- `fuzz_seconds` — seconds per target (time-based; default `1800`).
- `fuzz_runs` — iteration count per target (`-runs=N`). When set, it
  overrides `fuzz_seconds` so a run can be bounded by input count.

## Regression Replay (failures reproducible)

Crash artifacts found by `cargo-fuzz` are promoted into deterministic
`cargo test` cases via the **regression replay harness** at
`contracts/subscription/tests/fuzz_regressions.rs`. This runs on the
**stable** toolchain — no nightly/libfuzzer required.

### Triage → permanent regression guard

1. `contracts/fuzz/scripts/triage-crash.sh <target> <crash-file>` copies a
   crash into `contracts/subscription/tests/regressions/<target>_<sha>.bin`.
2. `cargo test --test fuzz_regressions` replays every `.bin` in that
   directory. A previously-crashing input that still crashes fails the
   test, so a fixed bug can never silently regress.

### Seeded in-process fuzz smoke

The harness also runs a deterministic, seeded in-process fuzzer whose
iteration count is configurable via `FUZZ_REGRESSION_ITERATIONS`
(default `64`):

```bash
# default 64 iterations
cargo test --manifest-path contracts/subscription/Cargo.toml --test fuzz_regressions

# heavier smoke
FUZZ_REGRESSION_ITERATIONS=1024 cargo test --test fuzz_regressions -- --nocapture
```

This gives a fast, reproducible fuzz smoke that runs in CI on every PR
(see the `regression-replay` job).

## CI Pipeline

The workflow in `.github/workflows/fuzz-test.yml`:

- Runs the coverage-guided targets **in parallel** via a build matrix
  (nightly + AddressSanitizer), bounded by `fuzz_seconds` or `fuzz_runs`
- Runs a **stable-toolchain regression-replay** job that replays all
  crash artifacts and the seeded fuzz smoke on every PR
- Crash artifacts are uploaded and kept for 14 days
- Seed corpus is cached between runs for coverage continuity
- Runs on every push/PR touching contracts and weekly on Monday

### Cache Strategy

The corpus directory is cached per-target, keyed by a hash of the
checked-in seed files. When a CI run discovers new interesting inputs
they are saved to the cache for the next run.

## Writing a New Target

1. Add a file `fuzz_targets/<name>.rs`
2. The file must contain `fuzz_target!(|data: &[u8]| { ... })`
3. Add a target entry to `.github/workflows/fuzz-test.yml` matrix
4. Create minimal seed files in `.github/corpus/<name>/`

```rust
// fuzz_targets/my_target.rs
#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if data.is_empty() { return; }
    // parse bytes and exercise contract functions
});
```
