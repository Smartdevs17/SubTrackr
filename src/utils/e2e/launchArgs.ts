/**
 * App-side reader for Detox launch arguments.
 *
 * The E2E suite (see `e2e/helpers/launchArgs.ts`) passes a deterministic config
 * through `device.launchApp({ launchArgs })`. On a real device those arrive via
 * the optional `react-native-launch-arguments` native module. Everything here is
 * defensive and a strict no-op in production: if the module is missing or no E2E
 * flag is set, `isE2E()` returns false and the rest of the app behaves normally.
 */

export interface E2ELaunchArgs {
  e2e?: string;
  e2eSeed?: string;
  e2eScenario?: string;
  e2eNow?: string;
  e2eLocale?: string;
  e2eTimezone?: string;
  e2eDisableAnimations?: string;
  e2eMockNetwork?: string;
}

let cached: E2ELaunchArgs | null = null;

export const getLaunchArgs = (): E2ELaunchArgs => {
  if (cached) return cached;

  let args: E2ELaunchArgs = {};
  try {
    // Optional native module — absent in production builds, web and unit tests.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-launch-arguments');
    const LaunchArguments = mod.LaunchArguments ?? mod.default ?? mod;
    if (LaunchArguments && typeof LaunchArguments.value === 'function') {
      args = (LaunchArguments.value() as E2ELaunchArgs) ?? {};
    }
  } catch {
    // Module not installed / not a native context — fall through to env.
  }

  if (!args.e2e && process.env.E2E === 'true') {
    args = { ...args, e2e: 'true' };
  }

  cached = args;
  return cached;
};

export const isE2E = (): boolean => getLaunchArgs().e2e === 'true';

/** Test-only: reset the memoized args (used by unit tests). */
export const __resetLaunchArgsCache = (): void => {
  cached = null;
};
