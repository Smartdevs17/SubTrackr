# Subscription Pause/Resume with Billing Adjustment

This document details the architecture, formulas, and integration patterns for subscription pause and resume functionality with billing adjustment in SubTrackr.

## Overview

SubTrackr allows subscribers to pause an active subscription for up to 30 days (`MAX_PAUSE_DURATION = 2,592,000` seconds). During the pause period:
- Automatic recurring billing is suspended.
- Unused prepaid service time is preserved.
- When the subscription is resumed (manually or via auto-resume expiration), the billing schedule (`next_charge_at` / `nextBillingDate`) is shifted forward by the actual elapsed pause duration.

---

## Technical Architecture

### 1. Smart Contract Implementation (`contracts/subscription/src/`)

- **State Fields**:
  - `status: SubscriptionStatus` (`Active`, `Paused`, `Cancelled`, `PastDue`)
  - `paused_at: u64` (ledger timestamp when pause was requested)
  - `pause_duration: u64` (requested pause duration in seconds)
  - `next_charge_at: u64` (timestamp for next charge)

- **Billing Adjustment Formula**:
  $$\text{elapsed\_pause} = \min(\text{resume\_timestamp} - \text{paused\_at}, \text{pause\_duration})$$
  $$\text{adjusted\_next\_charge\_at} = \text{next\_charge\_at} + \text{elapsed\_pause}$$

- **Contract Methods**:
  - `pause_subscription(env, proxy, storage, subscriber, subscription_id)`: Pauses subscription for default max duration (30 days).
  - `pause_by_subscriber(env, proxy, storage, subscriber, subscription_id, duration)`: Pauses subscription for custom duration $\le 30$ days.
  - `resume_subscription(env, proxy, storage, subscriber, subscription_id)`: Resumes subscription and adjusts `next_charge_at` by actual elapsed pause duration.
  - `preview_pause_adjustment(env, proxy, storage, subscription_id, resume_timestamp)`: Previews billing adjustments, credit amount, and shifted next charge date.

### 2. Frontend State Management (`src/store/subscriptionStore.ts`)

- **Store Actions**:
  - `pauseSubscription(id, durationDays)`: Sets `isPaused: true`, `isActive: false`, records `pausedAt`, `pauseDurationDays`, and `pausedUntil`.
  - `resumeSubscription(id)`: Calculates elapsed pause duration, shifts `nextBillingDate` forward by `pauseMs`, and reactivates subscription.
  - `previewPauseAdjustment(id, resumeDate)`: Returns `{ adjustedNextBillingDate, elapsedPauseDays, creditAmount }` preview.

---

## Events & Auditing

When a subscription is paused or resumed, contracts publish on-chain events:
- `("subscription_paused", subscriber)`: Payload `(subscription_id, paused_at, duration)`
- `("subscription_resumed", subscriber)`: Payload `subscription_id`

---

## API & Store Usage Examples

```typescript
import { useSubscriptionStore } from '../store/subscriptionStore';

// Pause a subscription for 14 days
await useSubscriptionStore.getState().pauseSubscription('sub_123', 14);

// Preview billing adjustment before resuming
const preview = useSubscriptionStore.getState().previewPauseAdjustment('sub_123');
console.log(`Adjusted next billing date: ${preview.adjustedNextBillingDate}`);

// Resume subscription
await useSubscriptionStore.getState().resumeSubscription('sub_123');
```
