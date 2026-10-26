# CDN Edge Caching

SubTrackr uses **Fastly** (primary) and **Cloudflare** (fallback) as edge CDNs
for static assets and public API responses.

## Architecture

```
Client → CDN edge (Fastly POP)
           ├── HIT  → serve from edge cache, skip origin
           └── MISS → origin shield → backend server
                          └── Cache-Control / Surrogate-Key headers
                              drive edge TTL and surrogate-key purge
```

### Layers

| Layer | What is cached | TTL |
|---|---|---|
| Static assets (JS bundles, images, fonts) | Fastly edge | 1 year (immutable) |
| Public API (`/plans`, `/pricing`, `/features`) | Fastly edge | 5 min + 60 s stale-while-revalidate |
| `/public/*` | Fastly edge | 1 hour |
| Per-user data / authenticated endpoints | Browser only (private) | Bypass CDN |

## Configuration

### app.json

The `extra.cdn` section in `app.json` controls CDN behaviour for the Expo client:

```json
"cdn": {
  "enabled": true,
  "provider": "fastly",
  "originShield": { "enabled": true, "pop": "us-east-1" },
  "staticTtlSeconds": 31536000,
  "publicApiTtlSeconds": 300,
  "staleWhileRevalidateSeconds": 60,
  "cacheWarmPaths": ["/plans", "/pricing", "/features", "/public/config"],
  "regions": ["us-east-1", "eu-west-1", "ap-southeast-1"]
}
```

### metro.config.js

Asset extensions are explicitly enumerated so Metro hashes all asset filenames,
enabling immutable `Cache-Control: max-age=31536000` headers at the CDN.

### Environment variables

| Variable | Description | Required |
|---|---|---|
| `CDN_PROVIDER` | `fastly` or `cloudflare` | No (default: `fastly`) |
| `CDN_API_TOKEN` | CDN API token for purge | Yes (production) |
| `CDN_SERVICE_ID` | Fastly service ID or Cloudflare zone ID | Yes (production) |

## Edge Caching for Public APIs

The Express middleware in `backend/shared/middleware/cacheHeaders.ts` attaches:

```
Cache-Control: public, s-maxage=300, max-age=300, stale-while-revalidate=60
Surrogate-Key: plan pricing
Cache-Tag: plan pricing
```

The TTL is overridable per-request via the `x-cache-ttl` header (clamped 1s–1h).
See `CACHEABLE_ROUTES` in `cacheHeaders.ts` for the full list of cached paths.

## Cache Invalidation

On deploy, the `cdn-cache-warm.sh` script:
1. Purges surrogate keys for each critical path.
2. Immediately warms the cache with fresh origin responses.

Run manually:
```bash
FASTLY_SERVICE_ID=xxx FASTLY_API_TOKEN=yyy ./scripts/cdn-cache-warm.sh
# Dry run (no actual requests):
./scripts/cdn-cache-warm.sh --dry-run
```

The `CdnPurgeClient` (`backend/shared/cache/cdnPurgeClient.ts`) is used
programmatically to purge by surrogate key after data mutations:

```ts
import { getCdnPurgeClient } from './backend/shared/cache/cdnPurgeClient';
await getCdnPurgeClient().purgeBySurrogateKeys(['plan', 'pricing']);
```

## Origin Shield

Origin shield is configured in `app.json` at `extra.cdn.originShield`.
At Fastly: enable via the Fastly UI → Shield tab → select `us-east-1` as the
shield POP. This ensures cache misses from all regions converge on one origin
request rather than fanning out across all POPs.

## Fastly VCL Snippets

Located in `infra/fastly/snippets/`:

| File | Subroutine | Purpose |
|---|---|---|
| `recv.vcl` | `vcl_recv` | Routes GET requests for `/plans`, `/pricing`, `/features`, `/public/*` to `lookup` (cache check) |
| `fetch.vcl` | `vcl_fetch` | Parses `s-maxage` from `Cache-Control` and sets `stale_while_revalidate` |

Deploy:
```bash
FASTLY_SERVICE_ID=xxx FASTLY_API_TOKEN=yyy ./scripts/deploy-fastly-vcl.sh
```

## Regional Performance Monitoring

The `cdn-regional-monitor.js` script polls the Fastly Real-Time Analytics API
every 60 seconds and reports cache hit rates per region:

```bash
# One-shot JSON report:
FASTLY_SERVICE_ID=xxx FASTLY_API_TOKEN=yyy node scripts/cdn-regional-monitor.js --once

# Continuous monitoring with Prometheus output:
FASTLY_SERVICE_ID=xxx FASTLY_API_TOKEN=yyy PROMETHEUS_OUTPUT=/tmp/cdn.prom \
  node scripts/cdn-regional-monitor.js --prometheus
```

The Prometheus metrics are scraped by the OTel collector (see `infra/otel-collector-config.yaml`).

### Alert thresholds

| Metric | Warn | Description |
|---|---|---|
| Global hit rate | < 60% | Low cache utilisation |
| Per-region hit rate | < 50% | Region-specific misconfiguration |
| Origin shield hit rate | < 80% | Shield bypass |

## Cache Warming for Critical Assets

After every deploy, the CI/CD pipeline runs:
```yaml
# .github/workflows/cdn-deploy.yml
- name: Warm CDN caches
  run: ./scripts/cdn-cache-warm.sh
  env:
    API_ORIGIN: ${{ secrets.API_ORIGIN }}
    FASTLY_SERVICE_ID: ${{ secrets.FASTLY_SERVICE_ID }}
    FASTLY_API_TOKEN: ${{ secrets.FASTLY_API_TOKEN }}
```

This guarantees the first post-deploy requests get cache HITs from all regions.

## Surrogate Keys

`backend/shared/cache/surrogateKeys.ts` defines the key taxonomy:

| Key | Purged when |
|---|---|
| `plan` | Plan created / updated / deactivated |
| `pricing` | Pricing table changes |
| `feature` | Feature flag changes |
| `config` | Public config changes |
| `user` | User-specific public data changes |
| `plan:<id>` | Specific plan updated |

## Files

| File | Purpose |
|---|---|
| `backend/shared/middleware/cacheHeaders.ts` | `Cache-Control` / `Surrogate-Key` middleware |
| `backend/shared/cache/cdnPurgeClient.ts` | Fastly & Cloudflare purge client |
| `backend/shared/cache/surrogateKeys.ts` | Surrogate key taxonomy |
| `infra/fastly/snippets/recv.vcl` | Fastly recv VCL snippet |
| `infra/fastly/snippets/fetch.vcl` | Fastly fetch VCL snippet |
| `scripts/deploy-fastly-vcl.sh` | Deploy VCL snippets to Fastly |
| `scripts/cdn-cache-warm.sh` | Post-deploy cache warming |
| `scripts/cdn-regional-monitor.js` | Regional hit-rate monitoring |
| `app.json` | `extra.cdn` configuration |
| `metro.config.js` | Asset extension + CDN asset config |
