# Backend FX conversion

The backend FX module is in `backend/src/fx/` and uses the Frankfurter API
(`api.frankfurter.app`) for daily exchange-rate snapshots published from
European Central Bank reference data. It requires no API key or additional
package. The server must have outbound HTTPS access to that host.

## Use

```ts
import { fxConversionService } from '../src/fx';

const result = await fxConversionService.convert(25, 'USD', 'EUR');
// result includes the rate, snapshotDate, source, and stale status
```

The module validates ISO-style three-letter currency codes and finite amounts,
rounds converted values to two decimal places by default, and reports missing
rates instead of silently treating the original amount as converted. Same-
currency conversions do not make a network request.

The existing billing `POST /currency/rates/refresh` controller now loads this
daily snapshot and returns its date, source, and stale status. It only updates
the billing rate cache from a fresh snapshot; stale data is reported but is not
silently installed into that cache.

Snapshots are cached per base currency for the current UTC day. Concurrent
requests for the same base currency share one fetch. When the source is
unavailable, the most recently fetched snapshot can be used if configured (the
default), up to five days old; the result is marked `stale: true` and a
structured warning is logged. If there is no suitably recent cached snapshot,
conversion fails with `FXSnapshotUnavailableError`.

Inject an `FXRateSource` when constructing `FXConversionService` to use another
daily snapshot provider or to isolate tests. The default Frankfurter client has
a five-second timeout; no dependency installation or environment secret is
required.

## Setup and tests

Use the repository's pinned package manager, `pnpm`; do not install an FX
package for this module. From the repository root, install project dependencies
only if they are not already present:

```bash
pnpm install
pnpm exec jest --config jest.backend.config.js backend/tests/fxConversionService.test.ts --runInBand
```
