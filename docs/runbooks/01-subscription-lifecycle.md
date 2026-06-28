# Runbook: Subscription Lifecycle Operations

Covers day-to-day operational procedures for managing subscription states on the SubTrackr Soroban contract.

## Subscription States

```
subscribe()
    │
    ▼
 [Active] ──pause_subscription()──► [Paused] ──resume_subscription()──► [Active]
    │                                   │
    │                                   │
    └──cancel_subscription()────────────┘
                │
                ▼
           [Cancelled]

charge_subscription() ──► payment fails ──► [PastDue]  (manual intervention required)
```

| Status    | Billable | Can Pause | Can Cancel | Can Charge |
| --------- | -------- | --------- | ---------- | ---------- |
| Active    | Yes      | Yes       | Yes        | Yes        |
| Paused    | No       | No        | Yes        | No         |
| Cancelled | No       | No        | No         | No         |
| PastDue   | No       | No        | Yes        | No         |

---

## Procedures

### Create a Subscription Plan

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- create_plan \
  --merchant $MERCHANT_ADDRESS \
  --name "Plan Name" \
  --price 10000000 \       # in stroops (1 XLM = 10,000,000 stroops)
  --token $TOKEN_ADDRESS \
  --interval Monthly       # Weekly | Monthly | Quarterly | Yearly
```

Verify the plan was created:

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- get_plan \
  --plan_id <RETURNED_ID>
```

---

### Charge a Due Subscription

`charge_subscription` is permissionless — any caller can trigger it.

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- charge_subscription \
  --subscription_id <ID>
```

Common errors:

| Error                     | Cause                             | Action                               |
| ------------------------- | --------------------------------- | ------------------------------------ |
| `Subscription not active` | Status is Paused/Cancelled        | Check status with `get_subscription` |
| `Payment not yet due`     | `next_charge_at` is in the future | Wait until due date                  |

---

### Process a Refund

**Step 1 — Subscriber requests refund:**

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- request_refund \
  --subscription_id <ID> \
  --amount <STROOPS>
```

**Step 2 — Admin approves or rejects (requires admin key):**

```bash
# Approve
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --source $ADMIN_KEY \
  -- approve_refund \
  --subscription_id <ID>

# Reject
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  --source $ADMIN_KEY \
  -- reject_refund \
  --subscription_id <ID>
```

Refund events emitted: `refund_requested`, `refund_approved`, `refund_rejected`.

---

### Deactivate a Plan

Prevents new subscribers. Existing subscriptions are unaffected.

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --network $NETWORK \
  -- deactivate_plan \
  --merchant $MERCHANT_ADDRESS \
  --plan_id <ID>
```

> Deactivation is irreversible. Confirm with the merchant before proceeding.

---

### Query Subscription State

```bash
# Get a single subscription
soroban contract invoke --id $CONTRACT_ID --network $NETWORK \
  -- get_subscription --subscription_id <ID>

# Get all subscriptions for a user
soroban contract invoke --id $CONTRACT_ID --network $NETWORK \
  -- get_user_subscriptions --subscriber $ADDRESS

# Get all plans for a merchant
soroban contract invoke --id $CONTRACT_ID --network $NETWORK \
  -- get_merchant_plans --merchant $ADDRESS
```

---

## Billing Cycle Reference

| Interval  | Seconds    | Approximate Duration |
| --------- | ---------- | -------------------- |
| Weekly    | 604,800    | 7 days               |
| Monthly   | 2,592,000  | 30 days              |
| Quarterly | 7,776,000  | 90 days              |
| Yearly    | 31,536,000 | 365 days             |

`next_charge_at = last_charged_at + interval_seconds`

---

## Notification Sync

After any subscription mutation, the mobile app syncs renewal reminders:

```ts
// Triggered automatically by subscriptionStore mutations
await notificationService.syncRenewalReminders(subscriptions);
```

Reminders are scheduled:

- 1 day before `nextBillingDate` if sufficient lead time exists
- 1 hour before `nextBillingDate` otherwise

Notifications are skipped when `isActive === false` or `notificationsEnabled === false`.
