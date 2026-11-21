# Affiliate & Referral Service (`backend/src/services/affiliate.ts`)

A production-grade affiliate attribution, referral tracking, and commission management engine for SubTrackr.

## Overview

Replaces legacy mock implementations with a typed, observable, and fraud-hardened affiliate subsystem.

### Key Capabilities

1. **Multi-Touch Attribution Engine**:
   Supports `last-touch`, `first-touch`, `linear`, `position-based` (40/40/20), and `time-decay` (7-day half-life) attribution models within configurable cookie windows.
2. **Built-in Fraud Engine**:
   - **Click Flooding Detection**: Automatically detects rapid clicks (>15/min) from identical sources, flags suspicious affiliates, and suspends accounts reaching high risk thresholds.
   - **Self-Referral Prevention**: Compares subscriber wallets, emails, and device fingerprints to reject fraudulent self-credits.
   - **Velocity Bot Checks**: Detects instant (<3s) automated click-to-convert scripts.
3. **Idempotent Conversions**:
   `convertReferral()` ensures conversions for the same subscription ID are never duplicated.
4. **Refund Clawbacks**:
   `processRefundClawback()` securely reverses pending commissions when purchases are refunded or charged back.
5. **Threshold-Gated Payouts**:
   `requestPayout()` ensures payouts only occur once affiliates cross minimum thresholds, transitioning pending commissions to `paid` status atomically.

## Usage Example

```typescript
import { AffiliateService } from './services/affiliate';

const affiliateService = new AffiliateService();

// Track incoming click
await affiliateService.trackClick('ALICE20', '198.51.100.12', 'Mozilla/5.0');

// Attribute and convert subscription
const commissions = await affiliateService.convertReferral({
  subscriptionId: 'sub_premium_123',
  amountMinor: 10000, // $100.00
  subscriberAddress: '0xCUSTOMER_WALLET',
  userIp: '198.51.100.12',
  userAgent: 'Mozilla/5.0',
  cookieReferralCode: 'ALICE20',
  attributionModel: 'last-touch',
});
```
