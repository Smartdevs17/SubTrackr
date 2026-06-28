import { getLaunchArgs, isE2E, __resetLaunchArgsCache } from '../launchArgs';
import { MOCK_SCENARIOS, DEFAULT_SCENARIO } from '../mockScenarios';

describe('e2e launchArgs', () => {
  const originalE2E = process.env.E2E;

  afterEach(() => {
    if (originalE2E === undefined) {
      delete process.env.E2E;
    } else {
      process.env.E2E = originalE2E;
    }
    __resetLaunchArgsCache();
  });

  it('is a no-op outside E2E (no native module, no env flag)', () => {
    delete process.env.E2E;
    __resetLaunchArgsCache();
    expect(isE2E()).toBe(false);
    expect(getLaunchArgs()).toEqual({});
  });

  it('activates when the E2E env flag is set', () => {
    process.env.E2E = 'true';
    __resetLaunchArgsCache();
    expect(isE2E()).toBe(true);
  });

  it('memoizes the resolved args', () => {
    process.env.E2E = 'true';
    __resetLaunchArgsCache();
    const first = getLaunchArgs();
    const second = getLaunchArgs();
    expect(second).toBe(first);
  });
});

describe('e2e mock scenarios', () => {
  it('exposes a valid default scenario', () => {
    expect(MOCK_SCENARIOS[DEFAULT_SCENARIO]).toBeDefined();
  });

  it('keys every route as "<METHOD> <path>"', () => {
    for (const scenario of Object.values(MOCK_SCENARIOS)) {
      for (const key of Object.keys(scenario.routes)) {
        expect(key).toMatch(/^(GET|POST|PUT|PATCH|DELETE) \/.+/);
      }
    }
  });
});
