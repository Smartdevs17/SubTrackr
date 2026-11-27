# Subscription Gift-Share Flow (`mobile/src/screens/gift/`)

A production-ready, accessible, and self-contained gift-sharing and transfer surface for SubTrackr mobile.

## Overview

Enables users to gift or transfer active software subscriptions to friends, colleagues, or team members via email or native Stellar blockchain addresses (`G...`), generating verifiable claim codes and shareable deep links with error recovery and sender revocation safeguards.

## Key Capabilities

1. **Dual Recipient Addressing**:
   - **Email**: Standard RFC 5322 email address validation.
   - **Stellar Public Key**: 56-character base32-encoded public key (`G...`) with automatic recipient-type detection.
2. **Deterministic Code & Deep-Link Generation**:
   - Secure uppercase alphanumeric claim codes (`SUB-XXXX-XXXX`).
   - Deep-link claim URL construction (`https://subtrackr.app/gift/claim?code=...`).
3. **Configurable Expiry & Revocation Safeguards**:
   - Customizable claim window (3, 7, 14, or 30 days) with deterministic expiry calculation.
   - Revocation safeguards: sender billing continues until the recipient claims the gift, allowing the sender to revoke unclaimed links.
   - Sender revocation toggle (`allowSenderRevoke`) persisted in transfer state.
4. **Multi-Delivery Methods**:
   - `share_link`: Copy link to clipboard or trigger native OS share sheet.
   - `direct_email`: Sends claim notification email to recipient.
   - `in_app`: Prepares in-app account transfer ticket.
5. **Resilient Error Recovery & Retry**:
   - Dedicated `error` state view with structured error messaging.
   - One-tap `Retry Send` re-attempts transaction without losing form context.
   - `Edit Details` action navigates back to recipient inputs to fix validation or addressing issues.
6. **Observability & Telemetry**:
   - Structured metrics hooks: `onView`, `onSelectSubscription`, `onStepChange`, `onGiftShareStart`, `onGiftShareSuccess`, `onGiftShareFailure`, `onRetry`, `onCopyLink`, `onShareLink`, `onReset`.
   - Pluggable logger interface (`info`, `warn`, `error`).
7. **Accessibility (WCAG 2.1 AA Compliant)**:
   - Proper `accessibilityRole` (`radio`, `radiogroup`, `switch`, `tab`, `tablist`, `button`, `alert`, `progressbar`, `header`).
   - High-contrast visual cues (#0F172A background, #1E293B surface, #3B82F6 primary, #10B981 success, #EF4444 error).
   - Minimum touch target dimensions (>= 48x48dp) across buttons, tabs, chips, and radio cards.

---

## State Machine & Steps

```
[select] ──> [recipient] ──> [confirm] ──> [processing] ──> [success]
   │             │               │             │
   │             │               │             v
   └─────────────┴───────────────┴───────> [error]
                                               │
                                     (Retry / Edit Details)
```

1. `select`: User chooses an eligible subscription from their active list. Ineligible subscriptions (paused/canceled) are disabled with clear status notes.
2. `recipient`: User inputs recipient email or Stellar address (with instant validation), delivery method, expiry window, sender revocation toggle, and optional personal note (up to 250 chars).
3. `confirm`: Summary review card highlighting subscription value, recipient details, expiration, revocation policy, and transfer conditions.
4. `processing`: Accessible spinner while registering the claim ticket.
5. `success`: Claim code, copyable link with clipboard feedback, native share sheet trigger, and done action.
6. `error`: Accessible failure card with error details, one-tap `Retry Send`, and `Edit Details` navigation.

---

## Usage

```tsx
import { GiftShareScreen } from './screens/gift';

<GiftShareScreen
  subscriptions={userSubscriptions}
  initialSubscriptionId="sub_netflix_4k"
  onSendGift={async (formState) => {
    return await billingApi.createGiftTransfer({
      subscriptionId: formState.subscriptionId,
      recipient: formState.recipientInput,
      recipientType: formState.recipientType,
      deliveryMethod: formState.deliveryMethod,
      personalMessage: formState.personalMessage,
      expiresInDays: formState.expiresInDays,
      allowSenderRevoke: formState.allowSenderRevoke,
    });
  }}
  onBack={() => navigation.goBack()}
  metrics={{
    onGiftShareSuccess: (result) => analytics.track('gift_created', result),
    onGiftShareFailure: (error) => analytics.track('gift_failed', { error }),
    onRetry: () => analytics.track('gift_retry'),
  }}
  logger={console}
/>
```

---

## Test Coverage

Unit and integration tests cover:
- **`__tests__/giftShareLogic.test.ts`**: Stellar public key and email regex validation, recipient auto-detection, expiry calculations and clamping, claim code formatting, eligibility checks, and URL building.
- **`__tests__/hooks.test.ts`**: Complete state machine lifecycle (`select` -> `recipient` -> `confirm` -> `processing` -> `success` / `error`), validation guards, error recovery and retry, clipboard copying, native share sheet invocation, state resets, and full telemetry firing.
- **`__tests__/GiftShareScreen.test.tsx`**: Component mounting, error views, processing indicators, props forwarding, and accessibility labels.
