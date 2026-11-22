# Recurring-charge contract

Soroban contract for recurring payments on calendar-aware billing cycles.
Source: [`contracts/src/recurring.rs`](../src/recurring.rs). This directory only
holds the crate manifest that makes it a workspace member.

## Why calendar-aware

`subtrackr_types::Interval::Monthly` is a fixed 30 days, so a subscription that
starts on Jan 31 drifts to Mar 2, Apr 1, and so on. This contract computes
every due date from the schedule's original start (the anchor):

| Anchor | Cycle | Due dates |
|---|---|---|
| 2028-01-31 09:00 | 1 month | Jan 31, Feb 29, Mar 31, Apr 30 (09:00 UTC each) |
| 2028-02-29 | 1 year | 2028-02-29, 2029-02-28, …, 2032-02-29 |
| 2026-11-30 | 3 months | Nov 30, Feb 28, May 30, Aug 30 |
| any | N days / weeks | exact multiples of 86 400 / 604 800 s |

Days are clamped to the last day of shorter months, and the time of day is
preserved. All dates are UTC.

## Flow

1. The payer calls `approve(payer, <this contract>, amount, expiration_ledger)`
   on the token, for at least one cycle's amount.
2. The payer calls `create_schedule(payer, merchant, token, amount, cycle,
   start, max_cycles)`. `start = None` means now. `max_cycles = 0` means
   unlimited.
3. A keeper (anyone) calls `charge(id)` when `next_attempt_at` is reached. Funds
   move with `transfer_from`, and the schedule advances one cycle.

## API

| Function | Auth | Notes |
|---|---|---|
| `create_schedule` | payer | Returns the schedule id. |
| `charge(id)` | none | Returns `Charged(cycle)`, `Failed(attempts)` or `Lapsed`. |
| `pause(id)` | payer | Active → Paused. |
| `resume(id)` | payer | Paused/Lapsed → Active. Returns the next due date. |
| `cancel(caller, id)` | payer or merchant | Final. |
| `get_schedule(id)` | none | Full `Schedule` state. |
| `preview_due_dates(id, limit)` | none | Up to 24 upcoming due dates. |

## Failure modes

| Situation | Behaviour |
|---|---|
| Called before the due date | `NotDue` error. Each cycle is charged at most once. |
| Keeper falls behind | Overdue cycles are charged one call at a time. |
| Payer lacks balance or allowance | No revert: returns `Failed(n)`, emits `failed`, next retry allowed after 24 h. |
| 3 consecutive failures | Schedule becomes `Lapsed` and emits `lapsed`. The payer can `resume`. |
| Paused or lapsed through due dates | Those cycles are skipped. `resume` continues at the next due date on the original anchor. |
| `max_cycles` reached | Schedule becomes `Completed` and emits `completed`. |

## Events

Topics are `("recurring", <action>, id)`, where the action is `created`,
`charged`, `failed`, `lapsed`, `paused`, `resumed`, `cancelled` or `completed`.

## Storage

Schedules live in persistent storage. Every write extends the entry's TTL to
about 120 days. A schedule that goes longer than that without any
interaction, such as a yearly cycle with no keeper activity, must have its
entry restored before its next charge.

## Testing

```bash
cd contracts
cargo test -p subtrackr-recurring
cargo clippy -p subtrackr-recurring --all-targets -- -D warnings
cargo build -p subtrackr-recurring --target wasm32v1-none --release
```
