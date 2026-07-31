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
