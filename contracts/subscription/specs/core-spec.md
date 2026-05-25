# SubTrackr Subscription Formal Specification

## Scope

This spec covers core safety properties for:

- `subscribe`
- `charge_subscription`
- `cancel_subscription`
- `pause_subscription` / `resume_subscription`
- `request_transfer` / `accept_transfer`

## Authorization Rules

1. Only authorized actor(s) can mutate subscription ownership or state.
2. Non-admin callers cannot bypass `require_auth`.
3. Refund approval/rejection can only be executed by admin.

## Balance Rules

1. `charge_subscription` transfers exactly `plan.price` from subscriber to merchant.
2. `total_paid` is monotonically non-decreasing except when explicit refunds are approved.
3. `refund_requested_amount` never exceeds `total_paid`.

## Reentrancy Threat Model

`charge_subscription` crosses trust boundaries when it invokes the plan token contract and the optional invoice contract. A malicious token or invoice implementation can call back into the proxy before the outer charge completes. The implementation therefore stores a shared `ReentrancyLock("charge_subscription")` in the state storage contract for the full charge flow.

Safety requirements:

1. A nested `charge_subscription` call must abort before a second token transfer can execute.
2. Subscription accounting and revenue state are written before external token or invoice calls.
3. The lock is removed after a successful charge and is reverted automatically if the transaction aborts.

## State Transition Rules

Allowed transitions:

- `Active -> Paused`
- `Paused -> Active`
- `Active|Paused -> Cancelled`

Disallowed transitions:

- `Cancelled -> Active`
- Any transition by unauthorized actors

## Invariants

1. `SubscriptionCount` is monotonically non-decreasing.
2. `Plan.subscriber_count >= 0` (underflow impossible).
3. `next_charge_at >= last_charged_at` for non-cancelled subscriptions.
4. A user has at most one active/non-cancelled subscription per plan (`UserPlanIndex` uniqueness).
