# Tax Receipt Service (`backend/src/services/taxReceipts.ts`)

A production-ready, international tax receipt and invoice generator for SubTrackr.

## Overview

Tax compliance requires deterministic calculation, auditable receipts, sequential numbering, reverse-charge handling, and tamper-evident digital seals.

### Key Capabilities

1. **Integer Minor-Unit Accuracy**:
   All money figures (unit prices, discounts, tax amounts, grand totals) are calculated and stored in integer minor units (cents). Floating-point roundoff errors are entirely prevented.
2. **Deterministic Idempotency**:
   `issueReceipt()` deduplicates by `paymentId`. Submitting multiple requests for the same payment transaction reliably returns the existing receipt without duplicate receipt numbering or ledger drift.
3. **Cross-Border B2B Reverse Charge**:
   Automatically detects B2B cross-border transactions when the buyer supplies a valid tax/VAT identifier. Sets tax to 0% and includes statutory legal notifications (Art. 194/196 EU VAT Directive).
4. **Tax Exemptions**:
   Supports certified tax-exempt institutions via `exemptionCertificateId`.
5. **Tamper-Evident Fiscal Seal**:
   Seals each receipt with an HMAC-SHA256 digital fingerprint over canonical fields. `verifyReceiptAuthenticity()` guarantees integrity during audits.
6. **Voiding & Credit Notes**:
   Compliant adjustments through `voidReceipt()` and negative credit notes via `issueCreditNote()`.

## Usage Example

```typescript
import { TaxReceiptService } from './services/taxReceipts';

const taxService = new TaxReceiptService();

const receipt = await taxService.issueReceipt({
  paymentId: 'tx_stellar_payment_123',
  currency: 'USD',
  seller: {
    legalName: 'SubTrackr Global Inc.',
    address: '100 Tech Way, San Francisco, CA',
    country: 'US',
    taxId: 'US-EIN-987654321',
  },
  buyer: {
    legalName: 'Acme Corp',
    address: '22 Market St, London',
    country: 'GB',
    isBusiness: true,
    taxId: 'GB987654321',
  },
  lineItems: [
    {
      description: 'Annual Enterprise Plan',
      quantity: 1,
      unitPriceMinor: 24000, // $240.00
      discountMinor: 4000,   // $40.00 coupon
      taxRateBps: 2000,      // 20% standard rate
    },
  ],
});
```
