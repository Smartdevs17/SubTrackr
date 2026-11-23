# Subscription Gift-Share Flow (`mobile/src/screens/gift/`)

A production-ready, accessible, and self-contained gift-sharing and transfer surface for SubTrackr mobile.

## Overview

Enables users to gift or transfer active software subscriptions to friends, colleagues, or team members via email or native Stellar blockchain addresses (`G...`), generating verifiable claim codes and shareable deep links.

## Key Capabilities

1. **Dual Recipient Addressing**:
   - **Email**: Standard RFC 5322 email address validation.
   - **Stellar Public Key**: 56-character base32-encoded public key (`G...`) with automatic recipient-type detection.
2. **Deterministic Code & Deep-Link Generation**:
   - Secure uppercase alphanumeric claim codes (`SUB-XXXX-XXXX`).
   - Deep-link claim URL construction (`https://subtrackr.app/gift/claim?code=...`).
3. **Configurable Expiry & Revocation**:
   - Customizable claim window (3, 7, 14, or 30 days) with deterministic expiry calculation.
   - Revocation safeguards: sender billing continues until the recipient claims the gift, allowing the sender to revoke unclaimed links.
4. **Multi-Delivery Methods**:
   - `share_link`: Copy link to clipboard or trigger native OS share sheet.
   - `direct_email`: Sends claim notification email to recipient.
   - `in_app`: Prepares in-app account transfer ticket.
5. **Observability & Telemetry**:
   - Structured metrics hooks: `onView`, `onSelectSubscription`, `onStepChange`, `onGiftShareStart`, `onGiftShareSuccess`, `onGiftShareFailure`, `onCopyLink`, `onShareLink`, `onReset`.
   - Pluggable logger interface (`info`, `warn`, `error`).
6. **Accessibility (WCAG 2.1 AA Compliant)**:
   - Proper `accessibilityRole` (`radio`, `tab`, `button`, `alert`, `progressbar`, `header`).
   - High-contrast visual cues (#0F172A background, #1E293B surface, #3B82F6 primary, #10B981 success, #EF4444 error).
   - Minimum touch target dimensions (>= 48x48dp) across buttons, tabs, chips, and radio cards.

---

## State Machine & Steps

```
[select] ──> [recipient] ──> [confirm] ──> [processing] ──> [success]
   │             │               │
   └─────────────┴───────────────┴─────────────────────────> [error]
```

1. `select`: User chooses an eligible subscription from their active list. Ineligible subscriptions (paused/canceled) are disabled with clear status notes.
2. `recipient`: User inputs recipient email or Stellar address (with instant validation), delivery method, expiry window, and optional personal note (up to 250 chars).
3. `confirm`: Summary review card highlighting subscription value, recipient details, and transfer conditions.
4. `processing`: Accessible spinner while registering the claim ticket.
5. `success`: Claim code, copyable link with clipboard feedback, native share sheet trigger, and done action.
6. `error`: Alert banner with retry support.

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
    });
  }}
  onBack={() => navigation.goBack()}
  metrics={{
    onGiftShareSuccess: (result) => analytics.track('gift_created', result),
  }}
/>
```

---

## Test Coverage

Unit tests in `__tests__/giftShareLogic.test.ts` and `__tests__/GiftShareScreen.test.tsx` cover:
- Stellar public key and email regex validation.
- Recipient auto-detection and error messages.
- Expiration calculations and clamping.
- Unique claim code formatting and URL building.
- Personal message character length limits.
- Screen rendering, step transitions, input updates, clipboard copying, native sharing, error handling, and telemetry firing.
