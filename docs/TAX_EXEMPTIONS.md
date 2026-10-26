# Tax Exemptions

## Overview

Customers who are tax-exempt (e.g. registered charities, government entities,
or businesses holding a resale/direct-pay certificate) can be flagged so that
SubTrackr **does not charge tax** on their invoices.

Issue #1740 adds three things on top of the pre-existing tax primitives in
`backend/services/billing/taxService.ts`:

1. **Persistence** of a per-customer exemption flag
   (`backend/migrations/008_customer_tax_status.sql`).
2. **Application at invoice time** — an exempt customer is billed with zero tax
   by the invoice controller.
3. **Auditing** — every flag change is recorded on the hash-chained audit trail.

> Scope note: plan-level / mid-cycle tax configuration (proration and
> group-billing engines) is unrelated to the per-customer exemption flag and
> is unchanged.

## Data model

`customer_tax_status` — one row per customer:

| Column                 | Meaning                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `customer_id`          | Customer key (invoice email or an explicit subscriber id)      |
| `is_exempt`            | The flag                                                        |
| `certificate_id`       | Exemption certificate reference                                 |
| `certificate_expiry`   | Certificate expiry in epoch milliseconds (`0` = never expires)  |
| `issuing_authority`    | Who issued the certificate                                      |
| `exempt_jurisdictions` | Jurisdiction keys covered; **empty array = all jurisdictions**  |
| `updated_by`           | Actor who last changed the flag                                 |

Generated invoices gain an `is_tax_exempt` column so an invoice records the
exemption that was applied when it was produced.

## API

All endpoints live under `/tax-exemptions` and return JSON.

### Set a customer's flag — `PUT /tax-exemptions`

```bash
curl -X PUT https://api.subtrackr.com/tax-exemptions \
  -H 'Content-Type: application/json' \
  -d '{
    "customerId": "acme@example.com",
    "isExempt": true,
    "certificateId": "EX-2026-0007",
    "certificateExpiry": 1900000000000,
    "issuingAuthority": "IRS",
    "exemptJurisdictions": ["US-CA"],
    "reason": "Resale certificate on file",
    "actorId": "admin-42"
  }'
```

`reason` is **required** — the change is a sensitive operation. The response
contains the stored status and the audit entry that was written.

### Read a customer's status — `GET /tax-exemptions/:customerId`

```bash
curl https://api.subtrackr.com/tax-exemptions/acme@example.com
# { "customerId": "...", "status": { "isExempt": true, ... }, "isExempt": true }
```

Returns `status: null` for a customer that has never been flagged.

### Read the audit trail — `GET /tax-exemptions/:customerId/audit`

```bash
curl https://api.subtrackr.com/tax-exemptions/acme@example.com/audit
# { "customerId": "...", "entries": [ { "action": "compliance.tax_exempt_change", ... } ] }
```

## How exemption is applied to invoices

`backend/billing/controller/invoiceController.ts` (`generateInvoice`) resolves
the tax rate from the request/region, then asks
`TaxExemptionService.isExempt(customerId, taxRegion)`:

- **Exempt** → `taxRate` is forced to `0`, the invoice is marked
  `isTaxExempt`, and `is_tax_exempt` is persisted. The jurisdiction is still
  recorded for reporting.
- **Not exempt** (unknown customer, out-of-scope jurisdiction, or expired
  certificate) → the normal region rate applies.
- **Lookup failure** → the region rate applies (fail-open) and the error is
  logged; an outage of the exemption store never blocks invoicing.

The customer key defaults to the invoice `customerEmail` when no explicit
`customerId` is supplied, matching how invoices are already keyed.

The PDF/email render the tax line only when `taxAmount > 0`, so exempt
invoices simply omit it.

## Auditing

Flag changes are recorded through `SensitiveOpsAuditController` using the
operation key `compliance.tax_exempt_change` (registered in
`backend/audit/sensitiveOperations.ts`):

- category `compliance`, severity `high`, `captureState: true`,
  `requiresReason: true`
- the audit entry carries the old and new status snapshots plus the reason

The entry is written **before** the flag is persisted — if the audit write
fails, the change is rejected and nothing is stored.

## Migration

`backend/migrations/008_customer_tax_status.sql` creates the table and adds
`invoices.is_tax_exempt`. Preview it with:

```bash
node scripts/db-migrate-dryrun.js --migrations-dir backend/migrations
```

## Tests

- `backend/services/billing/__tests__/taxExemptionService.test.ts`
- `backend/services/billing/__tests__/taxExemptionStore.test.ts`
- `backend/services/billing/__tests__/taxExemptionRouter.test.ts`
- `backend/billing/__tests__/invoiceTaxExemption.test.ts`

```bash
npx jest --config jest.backend.config.js --testPathPattern "taxExemption|invoiceTaxExemption"
```
