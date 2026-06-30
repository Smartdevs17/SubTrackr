import { device } from 'detox';
import { defaultMockScenario, MockNetworkScenarioName } from './mockServer';
import { SeededSubscription } from './testData';

/**
 * Deterministic launch configuration shared by every E2E test.
 *
 * The goal is that two runs of the same test — locally or in CI — start the app
 * in byte-identical state: same data, same clock, same locale, no animations and
 * a mocked network layer. All non-determinism (wall clock, RNG, live HTTP, OS
 * animation timing) is pinned through launch arguments that the app reads on boot
 * via `src/utils/e2e/e2eBootstrap.ts`.
 */
export interface E2ELaunchConfig {
  /** Subscriptions to hydrate the store with before the first frame renders. */
  seed?: SeededSubscription[];
  /** Named mock-network scenario; controls deterministic API responses. */
  scenario?: MockNetworkScenarioName;
  /** Fixed epoch millis used as the app clock (defaults to a stable instant). */
  now?: number;
  /** BCP-47 locale; pinned so date/number formatting is reproducible. */
  locale?: string;
  /** IANA timezone; pinned so "today"/billing math is reproducible. */
  timezone?: string;
  /** Disable UI animations to remove frame-timing flakiness. Default: true. */
  disableAnimations?: boolean;
  /** Wipe persisted storage before launch (fully isolated state). Default: true. */
  clean?: boolean;
}

/**
 * A fixed instant used as the default app clock during E2E runs:
 * 2024-01-15T12:00:00.000Z. Billing-date math and "next charge" calculations
 * become deterministic because they no longer depend on the real wall clock.
 */
export const FIXED_NOW_MS = 1705320000000;

const DEFAULTS: Required<Omit<E2ELaunchConfig, 'seed' | 'scenario'>> = {
  now: FIXED_NOW_MS,
  locale: 'en-US',
  timezone: 'UTC',
  disableAnimations: true,
  clean: true,
};

/**
 * Serialize an {@link E2ELaunchConfig} into Detox `launchArgs`. Complex values
 * are JSON-encoded because Detox only forwards string-ish scalars to the app.
 */
export const toLaunchArgs = (config: E2ELaunchConfig = {}): Record<string, string> => {
  const merged = { ...DEFAULTS, ...config };
  const args: Record<string, string> = {
    e2e: 'true',
    e2eNow: String(merged.now),
    e2eLocale: merged.locale,
    e2eTimezone: merged.timezone,
    e2eDisableAnimations: String(merged.disableAnimations),
    e2eScenario: config.scenario ?? defaultMockScenario,
    e2eMockNetwork: 'true',
  };
  if (config.seed && config.seed.length > 0) {
    args.e2eSeed = JSON.stringify(config.seed);
  }
  return args;
};

/**
 * Launch the app with a deterministic, hermetic configuration. Replaces ad-hoc
 * `device.launchApp` calls so every test gets identical, isolated startup state.
 */
export const launchApp = async (config: E2ELaunchConfig = {}): Promise<void> => {
  const clean = config.clean ?? DEFAULTS.clean;
  await device.launchApp({
    newInstance: true,
    delete: clean,
    launchArgs: toLaunchArgs(config),
    // Grant permissions up front so no OS dialog can interrupt a test mid-flow.
    permissions: { notifications: 'YES' },
    languageAndLocale: {
      language: (config.locale ?? DEFAULTS.locale).split('-')[0],
      locale: config.locale ?? DEFAULTS.locale,
    },
  });
};
