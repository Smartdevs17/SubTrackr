# Merchant Onboarding with KYC

## Overview

The merchant onboarding system provides a multi-step wizard for KYC (Know Your Customer) verification, enabling merchants to start accepting subscription payments.

## Onboarding Flow

### Step 1: Business Information
- Business name (required)
- Business type (LLC, Corporation, etc.)
- Country of operation
- Phone number
- Email address (required)

### Step 2: ID Document Upload
- Front of government-issued ID
- Back of government-issued ID
- Document verification status tracking

### Step 3: Business License
- Business license upload
- Supporting documentation

### Step 4: Review & Submit
- Summary of all provided information
- Document count verification
- Submit for verification review

## KYC Verification Tiers

### Basic Tier
- Monthly volume limit: $10,000
- Max transactions: 100
- Standard verification

### Enhanced Tier
- Monthly volume limit: $1,000,000
- Max transactions: 10,000
- Enhanced due diligence required

## Onboarding Statuses

| Status | Description |
|--------|-------------|
| `not_started` | Merchant has not begun onboarding |
| `in_progress` | Merchant is completing steps |
| `pending_review` | Submitted, awaiting admin review |
| `verified` | KYC verification approved |
| `rejected` | Verification denied |
| `expired` | Verification window expired |

## Onboarding Analytics

Track key metrics:
- **Completion rate**: Percentage of merchants who complete all steps
- **Drop-off rate**: Where merchants abandon the process
- **Average time to verify**: Duration from submission to decision
- **Document rejection rate**: Percentage of documents rejected

## Progress Tracking

The step indicator component shows:
- Current step highlighted
- Completed steps with checkmark
- Step labels for clarity

## Notifications

Merchants receive notifications for:
- Step completion reminders
- Verification status changes
- Document rejection with reasons
- Approval confirmation with tier assignment

## Navigation

Accessible from Settings tab at route `MerchantOnboarding`. Requires authentication.

## Technical Details

- **Screen**: `src/screens/MerchantOnboardingScreen.tsx`
- **Store**: `src/store/merchantStore.ts`
- **Types**: `src/types/merchant.ts`
- **KYC Service**: `backend/services/shared/` (KYC integration)
