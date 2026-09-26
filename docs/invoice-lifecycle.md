# Invoice lifecycle invariants

Invoices are created as `Draft` records and may transition only through this matrix:

| From | Allowed destinations |
| --- | --- |
| Draft | Sent, Void |
| Sent | Partial, Paid, Void |
| Partial | Paid, Void |
| Paid | none |
| Void | none |

The invoice contract validates the matrix at every status-changing entry point. Rejected, repeated, terminal, skipped, and out-of-order transitions abort before persistence, so the stored invoice and subscription index remain unchanged.

## Creation invariants

- The billing period must be non-empty (`start < end`).
- The source subscription cannot be cancelled.
- The source plan must be active.
- A new invoice must contain at least one line item.
- Amounts cannot be negative and `total` must equal `subtotal + tax`.
- New invoices always start in `Draft`.

## Failure behavior and compatibility

Validation uses Soroban contract assertions. A failed invocation rolls back the transaction, including invoice writes, invoice counters, and subscription indexes. Existing public status methods remain available; invalid calls now fail deterministically instead of mutating state. No storage migration is required because the existing invoice schema and storage keys are unchanged.

## Security assumptions

Status-changing methods remain administrator-authenticated. The contract does not infer payment settlement from caller intent; integrations must call the appropriate authenticated transition only after their payment verification succeeds. Soroban transaction atomicity is relied upon to prevent partial writes on failure.

## Rollback and operational limitations

Deployments can roll back the implementation using the repository's normal contract upgrade process. Existing malformed records from a prior implementation are not rewritten automatically; reads and future transitions validate their period and arithmetic invariants. Payment amounts are not tracked on the invoice record, so `Partial` is a lifecycle marker rather than a proportional settlement ledger.
