import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLaunchArgs, isE2E } from './launchArgs';
import { DEFAULT_SCENARIO, MOCK_SCENARIOS, MockResponse } from './mockScenarios';

/**
 * Hermetic E2E bootstrap. Runs once at app startup *before* the first screen
 * renders and is a strict no-op outside E2E. It pins the sources of
 * non-determinism that make Detox tests flaky:
 *
 *   1. Storage  — seeds the subscription store from `e2eSeed` so each test
 *                 starts with identical, known data.
 *   2. Network  — replaces `global.fetch` with a deterministic interceptor that
 *                 answers from a named mock scenario; the app never hits the wire.
 *   3. Clock    — exposes a fixed "now" on `globalThis.__E2E__` for app code that
 *                 wants reproducible time without monkeypatching Date globally.
 */

const SUBSCRIPTION_STORAGE_KEY = 'subtrackr-subscriptions';
const SUBSCRIPTION_STORE_VERSION = 1;

export interface E2ERuntimeConfig {
  now: number;
  locale: string;
  timezone: string;
  scenario: string;
  mockNetwork: boolean;
  disableAnimations: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __E2E__: E2ERuntimeConfig | undefined;
}

const buildConfig = (): E2ERuntimeConfig => {
  const args = getLaunchArgs();
  return {
    now: args.e2eNow ? Number(args.e2eNow) : Date.now(),
    locale: args.e2eLocale ?? 'en-US',
    timezone: args.e2eTimezone ?? 'UTC',
    scenario: args.e2eScenario ?? DEFAULT_SCENARIO,
    mockNetwork: args.e2eMockNetwork === 'true',
    disableAnimations: args.e2eDisableAnimations !== 'false',
  };
};

const seedSubscriptions = async (rawSeed: string): Promise<void> => {
  const seed = JSON.parse(rawSeed) as unknown[];
  // Match the zustand persist envelope so a rehydrate() picks the seed up.
  const envelope = JSON.stringify({
    state: { subscriptions: seed },
    version: SUBSCRIPTION_STORE_VERSION,
  });
  await AsyncStorage.setItem(SUBSCRIPTION_STORAGE_KEY, envelope);

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useSubscriptionStore } = require('../../store/subscriptionStore');
    if (useSubscriptionStore?.persist?.rehydrate) {
      await useSubscriptionStore.persist.rehydrate();
    }
  } catch {
    // Store not available in this context — seeded storage will hydrate normally.
  }
};

const matchRoute = (method: string, url: string): MockResponse | undefined => {
  const scenario = MOCK_SCENARIOS[globalThis.__E2E__?.scenario ?? DEFAULT_SCENARIO];
  if (!scenario) return undefined;
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // Relative URL — keep as-is.
  }
  return scenario.routes[`${method.toUpperCase()} ${pathname}`];
};

const installFetchInterceptor = (): void => {
  const realFetch = globalThis.fetch?.bind(globalThis);
  const wait = (ms?: number) => (ms ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const mock = matchRoute(method, url);

    if (mock) {
      await wait(mock.delayMs);
      return new Response(JSON.stringify(mock.body), {
        status: mock.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Unmapped request in a mocked run: fail loudly and deterministically rather
    // than silently leaking to the real network (the prime source of flakiness).
    if (realFetch && !globalThis.__E2E__?.mockNetwork) {
      return realFetch(input as RequestInfo, init);
    }
    return new Response(JSON.stringify({ error: 'unmocked_request', method, url }), {
      status: 501,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
};

export const applyE2EBootstrap = async (): Promise<void> => {
  if (!isE2E()) return;

  const config = buildConfig();
  globalThis.__E2E__ = config;

  if (config.mockNetwork) {
    installFetchInterceptor();
  }

  const args = getLaunchArgs();
  if (args.e2eSeed) {
    await seedSubscriptions(args.e2eSeed);
  }
};
