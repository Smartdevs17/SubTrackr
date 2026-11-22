# Trial Management

## Overview

SubTrackr provides a comprehensive trial management system with lifecycle tracking, conversion optimization, and A/B testing support.

## Trial Lifecycle

1. **Start** - A trial is created with `startTrial(subscriptionId, duration)`, setting status to `ACTIVE`.
2. **Extend** - Active trials can be extended using `extendTrial(trialId, ruleId)` if extension rules allow.
3. **Convert** - Trials transition to `CONVERTED` via `convertTrial(trialId)` when the user subscribes.
4. **Expire** - Trials auto-expire via `autoConvertEligibleTrials()` or manually via `expireTrial(trialId)`.

## Extension Rules

Extension rules define how trials can be extended:

- **maxExtensions**: Maximum number of times a trial can use this rule.
- **extensionDurationDays**: Number of days added per extension.
- **conditions**: Optional constraints (`minDaysRemaining`, `maxExtensionsUsed`, `requiredConversionEvents`).

Rules are managed in the trial store via `addExtensionRule()`.

## Conversion Funnel

The system tracks funnel events:
`trial_started` → `feature_accessed` → `dashboard_visited` → `payment_clicked` → `payment_completed` → `trial_converted`

Use `getTrialAnalytics()` for drop-off rates, time-to-convert, and per-variant stats.

## Notifications

`TrialNotificationService` handles scheduling:
- **Expiring soon**: Sent when trial has ≤3 days remaining.
- **Extended**: Sent on trial extension.
- **Expired/Converted**: Sent on status transitions.

## Analytics

`getTrialAnalytics()` returns:
- Conversion/expiry/cancellation rates
- Average time to convert/expire
- Funnel step conversion rates
- Drop-off analysis between funnel steps
- Daily conversion counts
- Per A/B test variant statistics
