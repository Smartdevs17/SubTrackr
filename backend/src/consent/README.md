# Consent Management Subsystem (`backend/src/consent/`)

Production-ready, GDPR (Articles 6 & 7) and CCPA-compliant consent orchestrator for SubTrackr.

## Overview

SubTrackr requires robust, auditable consent management for all optional data processing (usage telemetry, marketing notifications, price alerts, and third-party integrations).

### Key Guarantees

1. **Explicit Opt-in by Default (GDPR Art. 7(2))**:
   All non-essential categories default to `false`. Pre-ticked consent is strictly disallowed.
2. **Contractual Essential Grounding (GDPR Art. 6(1)(b))**:
   `essential` processing cannot be withdrawn by users while an active account/subscription exists, ensuring operational stability without consent confusion.
3. **Effortless Withdrawal (GDPR Art. 7(3))**:
   Users can withdraw consent at any time via `withdrawAll()` or selective category toggles with instantaneous effect.
4. **Tamper-Evident Audit Trail (GDPR Art. 7(1))**:
   Every consent mutation appends an immutable `ConsentRecord` sealed with an HMAC-SHA256 signature to prove compliance to regulators.
5. **Policy Version Invalidation**:
   When the privacy policy version increments, `requiresReconsent()` detects outdated user state and triggers a re-consent prompt.
6. **Data Portability & Erasure (GDPR Art. 15, 17, 20)**:
   Exports full user consent history via `exportConsentHistory()` and deletes records on erasure request (`forgetUser()`).

## Usage

```typescript
import { ConsentManager, InMemoryConsentRepository } from './src/consent';

const consentManager = new ConsentManager({
  policyVersion: '2026-11-01',
});

// Subscribe to real-time revocations to silence marketing/telemetry
consentManager.onConsentChanged(({ userId, category, granted }) => {
  if (!granted && category === 'marketing') {
    notificationService.disableMarketing(userId);
  }
});

// Update user preferences
await consentManager.updateConsent({
  userId: 'usr_123',
  source: 'mobile_app',
  preferences: {
    analytics: true,
    notifications: true,
    marketing: false,
  },
  ipAddress: '192.168.1.1',
});

// Check permissions prior to dispatching marketing email
const canMarket = await consentManager.isCategoryAllowed('usr_123', 'marketing');
```

## Observability & Metrics

The module exports `StructuredConsentTelemetry` capturing:
- `grants` (counter by category and source)
- `withdrawals` (counter by category and source)
- `reconsentRequired` (counter for outdated policy states)
- `verificationFailures` (counter for tampered records)
