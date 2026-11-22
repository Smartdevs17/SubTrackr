# Price-change alerter with scraping fallback

Issue #2013 — `backend/src/services/priceAlerts.ts`

## Overview

`createPriceAlerter` watches price quotes and emits alerts when a configured
percentage move occurs. Quote acquisition is layered:

1. primary market-data API provider;
2. optional secondary provider;
3. optional scraper-backed provider (regex rules over fetched page text);
4. a cached quote inside a bounded staleness window.

Only successful quotes are cached. Every failed attempt is logged and counted,
so a fallback is never silent.

## Usage

```ts
import {
  createHttpPriceProvider,
  createPriceAlerter,
  createScrapePriceProvider,
} from './src/services/priceAlerts';

const alerter = createPriceAlerter({
  primary: createHttpPriceProvider({
    url: (symbol) => `https://prices.example.com/v1/${symbol}`,
    apiKey,
  }),
  scrape: {
    scraper: { scrape: (symbol) => htmlFetcher.get(`/quote/${symbol}`) },
    rules: [{ symbol: 'BTC', pattern: /Spot:\s*\$([\d,.]+)/, currency: 'USD' }],
    currency: 'USD',
  },
  rules: [
    { id: 'btc-jump', symbol: 'BTC', changePercent: 2.5, direction: 'up', cooldownMs: 900_000 },
  ],
  sink: { send: (alert) => notificationService.dispatchPriceAlert(alert) },
  logger,
  metrics,
});

await alerter.setBaseline({
  symbol: 'BTC',
  price: 100,
  currency: 'USD',
  source: 'api',
  observedAt: Date.now(),
});
const result = await alerter.check('BTC');
```

## Contracts

- `PriceQuote` — `symbol`, positive `price`, ISO `currency`, `source`
  (`api` | `scrape`) and `observedAt` (epoch milliseconds).
- `AlertRule` — `id`, `symbol`, `changePercent`, optional `direction`
  (`up` | `down` | `both`), `cooldownMs` and `recipients`.
- `PriceAlert` — triggered direction, previous/current prices, absolute
  percentage move, source and delivery recipients.
- `PriceAlertError` codes: `INVALID_REQUEST`, `INVALID_QUOTE`, `FETCH_FAILED`,
  `PARSE_FAILED`, `NO_DATA`, `STALE_DATA`.

Defaults: 30 second cache TTL, 5 minute stale window, 15 minute per-rule
cooldown. All are injectable for tests.

## Observability

Counters use the `subtrackr.priceAlerts.` prefix: `cache_hit`,
`fetch_succeeded`, `fetch_failed`, `stale_served`, `alert_sent`, `alert_failed`,
`alert_suppressed`. Fetch and gauge timings include the symbol and source.
Structured logs contain symbols, sources and error codes only.

## Tests

`backend/src/services/__tests__/priceAlerts.test.ts` covers quote validation,
scraper parsing, direction/threshold logic, provider fallback, stale cache
behaviour, cooldown deduplication, sink failure isolation and HTTP parsing.
