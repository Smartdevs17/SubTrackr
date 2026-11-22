# CSV export with field-level encryption at rest

Issue #2007 — `backend/src/services/export.ts`

## Overview

`createCsvExportService` produces CSV exports whose PII columns are encrypted
**individually** before they reach the export store. Plaintext is reconstructed
only inside `download()`, so a database dump or a leaked store record contains
no plain email addresses, names, phone numbers or subscriber IDs.

Non-PII columns (plan, amount, status) remain plain so support tooling can
inspect them without a decryption key.

## API

```ts
import {
  createAesGcmFieldEncryption,
  createCsvExportService,
  createInMemoryCsvExportStore,
} from './src/services/export';

const service = createCsvExportService({
  store: createInMemoryCsvExportStore(),
  encryption: createAesGcmFieldEncryption({ masterKey: process.env.EXPORT_MASTER_KEY }),
  metrics,
  logger,
});

const summary = await service.create({
  ownerId: 'user-123',
  actorId: 'user-123',
  filename: 'billing-report',
  columns: [
    { key: 'email', header: 'Email', pii: true },
    { key: 'plan', header: 'Plan' },
  ],
  rows: [{ email: 'user@example.com', plan: 'pro' }],
  expiresInMinutes: 15,
});

const { content, filename, contentType } = await service.download(summary.exportId);
```

### Columns

| Field    | Type      | Meaning                                                 |
| -------- | --------- | ------------------------------------------------------- |
| `key`    | `string`  | Row property to read. Must be unique.                   |
| `header` | `string`  | CSV header. Must be unique.                             |
| `pii`    | `boolean` | When `true`, the cell is AES-256-GCM encrypted at rest. |

### Errors

`CsvExportError` carries a machine-readable `code`:
`INVALID_REQUEST`, `NOT_FOUND`, `EXPIRED`, `INTEGRITY_ERROR`,
`INVALID_ENCRYPTED_CELL`, `UNKNOWN_KEY`, `ENCRYPTION_FAILED`.

## Storage format

A stored export holds column metadata, encrypted cell strings, `createdAt`,
`expiresAt`, row/encrypted-cell counts and a SHA-256 checksum of the stored
payload. Encrypted cells are JSON-serialised `EncryptedField` values from
`backend/services/shared/encryption.ts` (`ciphertext`, `iv`, `authTag`, `keyId`,
`algorithm: 'aes-256-gcm'`).

The checksum is verified before any decryption. Expired downloads are rejected
and removed from the store.

## Key management

`createAesGcmFieldEncryption` derives a 32-byte data key from a 32-byte master
key with the shared HMAC-based key derivation. Supply a stable master key from
the deployment secret store; the generated process-local fallback is intended
for development only. Additional keys can be registered with `registerKey()`
to support rotation while older exports remain readable by `keyId`.

## Observability

All operations emit Prometheus-style counters prefixed `subtrackr.csvExport`
(`created`, `downloaded`, `removed`, `not_found`, `expired`, `integrity_failed`,
`encryption_failed`, `decryption_failed`) and `create`/`download` timings.
Structured log lines contain IDs and counts only — never cell values.

## Tests

`backend/src/services/__tests__/export.test.ts` covers CSV escaping,
at-rest encryption, decryption on download, expiry, checksum tampering,
unknown keys, malformed cells and validation.
