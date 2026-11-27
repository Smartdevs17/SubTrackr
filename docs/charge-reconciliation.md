# Charge reconciliation

`backend/src/reports/reconciliation.ts` reconciles SubTrackr ledger charges
against charge snapshots returned by configured payment providers.

## Matching rules

- Provider charge ID is the primary match key.
- Ledger `referenceId` can match a provider `referenceId`.
- Provider and ledger duplicates for the same key are reported as duplicates.
- Amount, currency, and status differences are reported as separate mismatch issues.
- Records that exist only in the ledger or only in a provider snapshot are reported explicitly.

Provider fetch failures are included in `providerErrors`; reconciliation continues
for provider sources that succeed. A provider error does not silently turn every
ledger record for that provider into a provider-only or ledger-only mismatch.

## Usage

```ts
const report = await reconcileCharges(ledgerRecords, providerSources, {
  startInclusive: '2026-11-20T00:00:00.000Z',
  endExclusive: '2026-11-21T00:00:00.000Z',
});

console.log(report.totals);
```

The report is also sent to an injected metrics sink and a PII-safe structured
logger. Invalid charge records and invalid currency codes fail the reconciliation
without producing a partial report.

## Tests

```bash
npx jest --config jest.backend.config.js --testMatch '**/backend/src/reports/__tests__/reconciliation.test.ts' --runInBand
```
