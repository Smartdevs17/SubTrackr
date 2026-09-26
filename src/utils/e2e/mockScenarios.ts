/**
 * App-side mirror of the E2E mock-network scenarios defined in
 * `e2e/helpers/mockServer.ts`. Kept in sync intentionally: the test side selects
 * a scenario *by name*, and this table is what the in-app `fetch` interceptor
 * uses to answer requests deterministically. If you add a route in one file,
 * add it in the other.
 */

export interface MockResponse {
  status: number;
  body: unknown;
  delayMs?: number;
}

export interface MockNetworkScenario {
  name: string;
  routes: Record<string, MockResponse>;
}

const EXCHANGE_RATES: MockResponse = {
  status: 200,
  body: {
    base: 'USD',
    rates: { USD: 1, EUR: 0.92, GBP: 0.79, NGN: 1550, JPY: 148.5 },
    asOf: '2024-01-15T12:00:00.000Z',
  },
};

const GAS_PRICE_OK: MockResponse = {
  status: 200,
  body: { chainId: 1, gwei: 21, asOf: '2024-01-15T12:00:00.000Z' },
};

export const MOCK_SCENARIOS: Record<string, MockNetworkScenario> = {
  'happy-path': {
    name: 'happy-path',
    routes: {
      'GET /v1/exchange-rates': EXCHANGE_RATES,
      'GET /v1/gas-price': GAS_PRICE_OK,
      'POST /v1/charges': { status: 201, body: { id: 'chg_seed_1', status: 'succeeded' } },
    },
  },
  'charge-failure': {
    name: 'charge-failure',
    routes: {
      'GET /v1/exchange-rates': EXCHANGE_RATES,
      'GET /v1/gas-price': GAS_PRICE_OK,
      'POST /v1/charges': {
        status: 402,
        body: { id: 'chg_seed_2', status: 'failed', error: 'insufficient_funds' },
      },
    },
  },
  'degraded-network': {
    name: 'degraded-network',
    routes: {
      'GET /v1/exchange-rates': { ...EXCHANGE_RATES, delayMs: 800 },
      'GET /v1/gas-price': { ...GAS_PRICE_OK, delayMs: 800 },
      'POST /v1/charges': {
        status: 201,
        body: { id: 'chg_seed_3', status: 'succeeded' },
        delayMs: 800,
      },
    },
  },
};

export const DEFAULT_SCENARIO = 'happy-path';
