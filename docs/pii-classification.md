# PII Classification & Redaction Pipeline (#668)

Configurable PII detection, automated redaction for API responses / logs, and a data lineage audit trail.

---

## Quick start

```ts
import { redact, piiClassifier, createPiiRedactionMiddleware } from '@backend/services/shared';

// Deep-redact any object (default: standard level)
const safe = redact({ email: 'jane@example.com', planId: 'plan_basic' });
// → { email: '[REDACTED_EMAIL]', planId: 'plan_basic' }

// Express middleware — auto-redacts every outgoing res.json() body
app.use(createPiiRedactionMiddleware());        // standard
app.use(createPiiRedactionMiddleware('strict')); // strict
```

---

## Classification levels

| Level | What is redacted |
|-------------|------------------|
| `permissive`| Passwords, secrets, API keys only |
| `standard`  | + email, phone, SSN (last-4 preserved), credit card (last-4 preserved), crypto addresses |
| `strict`    | + IP addresses, names, addresses, DOB; SSN / card fully masked |

```ts
import { redact } from '@backend/services/shared';

redact(data, { level: 'strict' });
```

---

## Built-in PII patterns

| Pattern name | Triggers on | Min level |
|---|---|---|
| `password` | field name: password, secret, api_key, token… | permissive |
| `ssn` | value: `\d{3}-\d{2}-\d{4}` (last-4 kept) | standard |
| `ssn_strict` | same (full mask) | strict |
| `credit_card` | 16-digit card number (last-4 kept) | standard |
| `credit_card_strict` | 16-digit card (full mask) | strict |
| `email` | value: RFC5321 email | standard |
| `email_field` | field name: `email` | standard |
| `phone` | value: NA phone format | standard |
| `phone_field` | field name: phone, mobile, cell, tel | standard |
| `crypto_address` | Stellar G…, Ethereum 0x…, Bitcoin | standard |
| `ip_address` | IPv4 | strict |
| `dob_field` | field name: dob, date_of_birth… | standard |
| `address_field` | field name: address, street, zipcode… | strict |
| `name_field` | field name: full_name, first_name… | strict |

---

## Adding custom patterns

```ts
import { PiiClassifier } from '@backend/services/shared';

const classifier = new PiiClassifier([
  {
    name: 'stellar_account',
    fieldPattern: /^(account_id|stellar_address)$/i,
    replacement: '[REDACTED_STELLAR]',
    minLevel: 'standard',
  },
]);

const safe = classifier.redact(data, { level: 'standard' });
```

You can also pass `customPatterns` per-call via `redact()`:

```ts
import { redact } from '@backend/services/shared';

redact(data, {
  level: 'standard',
  customPatterns: [{ name: 'internal_id', fieldPattern: /^internalId$/, replacement: '[INTERNAL]', minLevel: 'standard' }],
});
```

---

## Allowlisting fields

Fields in the `allowList` are never redacted, even if they match a pattern:

```ts
redact(data, { allowList: ['email'] }); // keep email as-is
```

---

## Log PII redaction

All structured log context is automatically sanitized before output.
Change the level at startup:

```ts
import { logger } from '@backend/services/shared';

logger.setRedactionLevel('strict'); // default: 'standard'
```

---

## Data lineage tracking

```ts
import { piiAuditService } from '@backend/services/shared';

// Record that a user's PII passed through the billing module
piiAuditService.trackLineage('user_123', 'User', {
  stepId: 'billing-invoice-gen',
  module: 'billing',
  operation: 'invoice_generate',
  fields: ['email', 'phone'],
  protection: 'encrypted',
});

// Retrieve the full trail for GDPR subject-access requests
const trail = piiAuditService.getLineage('user_123', 'User');

// Clear on deletion (GDPR right-to-erasure)
piiAuditService.clearLineage('user_123', 'User');
```

---

## PII audit report

```ts
const report = piiAuditService.generateReport(Date.now() - 86_400_000, Date.now());
// report.totalAccesses
// report.byAction       — { 'pii.viewed': 42, 'pii.exported': 3, … }
// report.topActors      — [{ actorId, count }, …]
// report.highRiskEvents — exported + deleted events
// report.lineageSummary — { userId: { nodeCount, modules } }
```

---

## API response redaction

```ts
import { ok, redactResponse } from '@backend/services/shared';

// Explicitly redact a single response
const response = ok(userData, requestId);
res.json(redactResponse(response));            // standard
res.json(redactResponse(response, 'strict')); // strict
```

---

## Edge cases handled

- **False positives** — `example@test.com` in test data is redacted at standard level (this is intentional for production safety). Use `allowList` in test environments.
- **Partial PII** — last-4 of SSN and credit card are preserved at `standard` level.
- **International formats** — phone patterns match North American format; add custom patterns for other locales.
- **Nested JSON** — `redact()` deep-walks objects and arrays.
- **Unicode** — string normalization is handled by the JS `RegExp` engine natively.
- **Immutability** — `redact()` returns a new object; the original is never mutated.
