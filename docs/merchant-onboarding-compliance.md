# Merchant Onboarding and Compliance

This module provides a minimal onboarding/compliance verification flow for merchants.

## Flow
1. Start onboarding
2. Submit KYB/compliance documents
3. Request verification
4. Approve or reject with tier/notes

## API Surface
- `InMemoryMerchantOnboardingService` in `backend/services/merchant/onboardingService.ts`
- Exported from `backend/services/index.ts`

## Compliance Notes
- Document submissions are tracked with timestamps and status.
- Verification decisions capture reviewer notes and tier.
