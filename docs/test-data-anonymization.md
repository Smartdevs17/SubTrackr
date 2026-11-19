# Test data anonymization

**Issue:** #1287 — Add automated test data anonymization

`scripts/anonymize-test-data.js` finds real personal data in test fixtures and
replaces it with deterministic placeholders, so a fixture that accidentally
contains a real customer's email address or card number can be committed and
then caught in CI.

It is zero-dependency and deterministic: the same input always produces the same
output, which keeps fixture diffs reviewable.

## Quick start

```bash
# Fail if any fixture contains PII (this is what CI runs)
npm run test:data:anonymize:check

# Rewrite the offending fixtures in place
npm run test:data:anonymize

# Narrow the scope
node scripts/anonymize-test-data.js --check --paths app/tests,backend/tests
node scripts/anonymize-test-data.js --write --exclude '**/*.snap'

# Machine-readable report
node scripts/anonymize-test-data.js --check --json
```

## What it detects

| Category        | Examples                                                     |
| --------------- | ------------------------------------------------------------ |
| Email           | `user@example.com`, `first.last+tag@corp.co.uk`               |
| Phone           | `+1 (415) 555-0132`, `+44 20 7946 0958`                      |
| Payment card    | `4111 1111 1111 1111`, `4111-1111-1111-1111`                 |
| US SSN          | `123-45-6789`                                                 |
| IPv4            | `192.168.1.100` (private ranges included)                      |
| API key         | `sk_live_…`, `ghp_…`, `xoxb-…`, `AIza…`                      |
| JWT             | `eyJhbGciOi…` three-segment tokens                             |
| Private key     | `-----BEGIN … PRIVATE KEY-----` blocks                        |
| Street address  | `1600 Pennsylvania Avenue NW`                                 |

## What it will not touch

False positives are worse than misses here, because a mangled fixture is a
broken fixture. The scanner therefore skips:

- **Reserved and synthetic values.** `example.com`, `@example.org`, `user@localhost`,
  RFC 2606/5737 documentation ranges, and the `555-01xx` phone block.
- **The test card number.** `4111 1111 1111 1111` and friends are public test
  values, not real cards.
- **Obfuscated placeholders.** Values already wrapped in a placeholder marker are
  left alone, which is what makes the tool idempotent.
- **Explicit excludes.** `--exclude` accepts glob patterns.

## Why it is safe to run in CI

- **Idempotent.** Running it twice produces no second diff, so `--check` is
  stable across repeated runs.
- **Deterministic.** Placeholders are derived from a content hash, not a random
  source, so two developers anonymizing the same file get the same result.
- **Advisory by default.** `--check` only reports; nothing is written unless you
  pass `--write`.
- **Report-first.** A scan always completes and reports every finding, rather
  than stopping at the first hit.

Fixture discovery is automatic: the tool walks the repository for conventional
fixture and test directories and never rewrites production source. Pass
`--paths` when you need to force a specific scope.

## Exit codes

| Code | Meaning                                              |
| ---- | ---------------------------------------------------- |
| `0`  | clean — no findings                                  |
| `1`  | findings present (`--check`)                         |
| `2`  | usage error, or a target path that does not exist    |

## Tests

```bash
npx jest scripts/__tests__/anonymize-test-data.test.js
```

Covers every detector, the reserved/synthetic allow-list, idempotency,
determinism, and the `--check` / `--write` / `--json` / `--paths` / `--exclude`
CLI surface.
