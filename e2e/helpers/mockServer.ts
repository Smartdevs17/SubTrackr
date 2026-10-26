/**
 * Mock network layer contract for E2E tests.
 *
 * Live HTTP is the single biggest source of E2E flakiness: rate limits, latency,
 * and changing upstream data all produce non-reproducible failures. Instead the
 * app ships an interceptor (`src/services/network/apiClient.ts` +
 * `src/utils/e2e/e2eBootstrap.ts`) that, when launched with `e2eMockNetwork=true`,
 * serves responses from a named scenario defined here.
 *
 * A "scenario" is a deterministic map of endpoint → canned response. Tests pick a
 * scenario by name through the launch config; the app never touches the network.
 */

export interface MockResponse {
  status: number;
  /** JSON body returned verbatim — must be fully deterministic. */
  body: unknown;
  /** Optional fixed latency (ms) to exercise loading states without real I/O. */
  delayMs?: number;
}

export interface MockNetworkScenario {
  name: string;
  description: string;
  /** Keyed by `"<METHOD> <path>"`, e.g. `"GET /v1/exchange-rates"`. */
  routes: Record<string, MockResponse>;
}

const EXCHANGE_RATES: MockResponse = {
  status: 200,
  body: {
    base: 'USD',
    // Frozen rates → currency conversions render identically every run.
    rates: { USD: 1, EUR: 0.92, GBP: 0.79, NGN: 1550, JPY: 148.5 },
    asOf: '2024-01-15T12:00:00.000Z',
  },
};

const GAS_PRICE_OK: MockResponse = {
  status: 200,
  body: { chainId: 1, gwei: 21, asOf: '2024-01-15T12:00:00.000Z' },
};

/** Baseline: everything healthy and fast. The default for most tests. */
const happyPath: MockNetworkScenario = {
  name: 'happy-path',
  description: 'All upstream services return successful, frozen responses.',
  routes: {
    'GET /v1/exchange-rates': EXCHANGE_RATES,
    'GET /v1/gas-price': GAS_PRICE_OK,
    'POST /v1/charges': { status: 201, body: { id: 'chg_seed_1', status: 'succeeded' } },
  },
};

/** Charge endpoint fails deterministically — drives failed-billing UI assertions. */
const chargeFailure: MockNetworkScenario = {
  name: 'charge-failure',
  description: 'Charge endpoint returns a deterministic 402 to test failure UI.',
  routes: {
    'GET /v1/exchange-rates': EXCHANGE_RATES,
    'GET /v1/gas-price': GAS_PRICE_OK,
    'POST /v1/charges': {
      status: 402,
      body: { id: 'chg_seed_2', status: 'failed', error: 'insufficient_funds' },
    },
  },
};

/** Slow-but-successful responses — exercises spinners without real latency jitter. */
const degradedNetwork: MockNetworkScenario = {
  name: 'degraded-network',
  description: 'Successful responses with a fixed delay to test loading states.',
  routes: {
    'GET /v1/exchange-rates': { ...EXCHANGE_RATES, delayMs: 800 },
    'GET /v1/gas-price': { ...GAS_PRICE_OK, delayMs: 800 },
    'POST /v1/charges': {
      status: 201,
      body: { id: 'chg_seed_3', status: 'succeeded' },
      delayMs: 800,
    },
  },
};

export const mockScenarios = {
  'happy-path': happyPath,
  'charge-failure': chargeFailure,
  'degraded-network': degradedNetwork,
} as const;

export type MockNetworkScenarioName = keyof typeof mockScenarios;

export const defaultMockScenario: MockNetworkScenarioName = 'happy-path';

export const getScenario = (name: MockNetworkScenarioName): MockNetworkScenario =>
  mockScenarios[name];
