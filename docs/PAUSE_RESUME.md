# Subscription Pause / Resume with Billing Adjustment

Issue #786 — pause duration, prorated credits, resume billing restart, limits, notifications, and analytics.

## Overview

When a subscriber pauses, SubTrackr:

1. Validates pause duration against configurable limits
2. Issues a **prorated pause credit**
3. Schedules pause / reminder / resume notifications
4. On resume, optionally clawbacks unused credit (early resume) and **shifts the next billing date** by the pause duration

Client pause UX lives in `PauseSubscriptionScreen` / `PauseResumeScreen` and `pauseStore`. Server-side billing math is centralized in `PauseBillingService`.

## Pause Flow

```
Preview → Enforce limits → Create pause_credit → Schedule notifications
                                              ↓
                                    (paused period)
                                              ↓
Early resume? ──yes──► early_resume_clawback + resume_restart
            └──no───► resume_restart (full pause days)
```

1. **Preview** — `previewAdjustment(price, billingCycleDays, pauseDays)` returns expected credit without mutating state.
2. **Pause** — `createPauseAdjustment(...)` persists a `pause_credit` adjustment and an active pause record.
3. **Notifications** — `scheduleNotifications(subscriptionId, pauseDays, resumeAt)` queues `paused`, `resume_reminder`, and `resumed`.
4. **Resume** — early resume creates a clawback for unused credit; always creates a `resume_restart` that shifts the next billing date.

## Billing Formulas

### Pause credit

```
credit = (pauseDays / periodDays) * price
```

Rounded to 2 decimal places. Matches `calculatePauseCredit` in `src/store/pauseStore.ts`.

Example: price `$30`, period `30` days, pause `10` days → credit `$10.00`.

### Early resume clawback

When the subscriber resumes before the scheduled end:

```
daysRemaining = pauseDays - daysUsed
remainingCredit = (daysRemaining / pauseDays) * originalCredit
```

The `early_resume_clawback` adjustment amount equals `remainingCredit` (unused portion of the original pause credit).

### Resume billing restart

```
nextBillingDate = currentNextBillingDate + pauseDays (or daysUsed if early)
```

Stored as a `resume_restart` adjustment with `nextBillingDate` set.

## Pause Limits

Defaults (`DEFAULT_PAUSE_LIMITS`):

| Limit | Default |
|-------|---------|
| `minDays` | 7 |
| `maxDays` | 90 |
| `maxPausesPerYear` | 2 |

`enforceLimits(history, pauseDays, limits)` rejects:

- Duration outside min/max
- An already-active pause on the subscription
- Exceeding max pauses in the current calendar year

Approaching the yearly cap sets `warning: true` so the API can emit a `limit_warning` notification.

Configure via `PUT /pause/limits`.

## Notifications

| Type | When |
|------|------|
| `paused` | Immediately on pause |
| `resume_reminder` | 1 day before scheduled resume |
| `resumed` | At scheduled resume time |
| `limit_warning` | When approaching yearly pause cap |

Channels: `email`, `push`, `in_app` (default `email`).

## Analytics

`getAnalytics(records, adjustments)` returns:

| Field | Meaning |
|-------|---------|
| `totalPauses` | All pause records |
| `activePauses` | Currently paused |
| `averagePauseDays` | Mean pause length |
| `totalCreditsIssued` | Sum of `pause_credit` amounts |
| `totalCreditsRemaining` | Sum of remaining credits on records |
| `resumeRate` | % of pauses that resumed |
| `earlyResumeRate` | % of resumes that were early |
| `byReason` | Counts keyed by pause reason |

## API

Mount with `createPauseBillingRouter()` from `backend/billing/router/pauseBillingRouter.ts`.

Responses use the standard `ok` / `fail` envelope from `apiResponse`. Conflict when already paused: `SUBSCRIPTION_PAUSED` (HTTP 409).

### `POST /subscriptions/:id/pause`

Body:

```json
{
  "pauseDays": 14,
  "reason": "vacation",
  "price": 30,
  "billingCycleDays": 30,
  "currency": "USD"
}
```

Returns `201` with adjustment, notifications, resumeAt, and active record.

### `POST /subscriptions/:id/resume`

Body:

```json
{
  "early": true,
  "currentNextBillingDate": "2026-08-15T00:00:00.000Z",
  "billingCycleDays": 30,
  "currency": "USD"
}
```

Returns clawback (if early), restart adjustment, and shifted `nextBillingDate`.

### `GET /subscriptions/:id/pause/preview`

Query: `pauseDays`, `price`, `billingCycleDays` (optional, default 30), `currency` (optional).

### `GET /subscriptions/:id/pause/history`

Returns pause records and billing adjustments for the subscription.

### `GET /pause/analytics`

Global pause analytics report.

### `GET /subscriptions/:id/pause/notifications`

Scheduled / sent pause notifications for the subscription.

### `PUT /pause/limits`

Body (partial): `{ "minDays": 7, "maxDays": 90, "maxPausesPerYear": 2 }`.

## Code Map

| Area | Path |
|------|------|
| Types | `src/types/pauseBilling.ts`, `src/types/pause.ts` |
| Service | `src/services/pauseBillingService.ts` |
| Client store | `src/store/pauseStore.ts` |
| Screens | `src/screens/PauseSubscriptionScreen.tsx`, `PauseResumeScreen.tsx` |
| Controller | `backend/billing/controller/pauseBillingController.ts` |
| Router | `backend/billing/router/pauseBillingRouter.ts` |
| Tests | `src/services/__tests__/pauseBillingService.test.ts` |
