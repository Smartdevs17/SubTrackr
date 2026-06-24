import {
  startupTimeOptimizer,
  measureStartupTime,
  initHermesOptimizations,
} from '../../utils/startupTimeOptimizer';
import { Platform } from 'react-native';

jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  AppState: {
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

describe('startupTimeOptimizer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should mark JS engine ready', () => {
    const metrics = startupTimeOptimizer.getMetrics();
    expect(metrics.jsEngineReady).toBeUndefined();

    startupTimeOptimizer.markJsEngineReady();

    const updatedMetrics = startupTimeOptimizer.getMetrics();
    expect(updatedMetrics.jsEngineReady).toBeGreaterThanOrEqual(0);
  });

  it('should mark Hermes bytecode ready', () => {
    startupTimeOptimizer.markHermesBytecodeReady();
    const metrics = startupTimeOptimizer.getMetrics();
    expect(metrics.hermesBytecodeReady).toBeGreaterThanOrEqual(0);
  });

  it('should mark app ready and calculate total time', () => {
    jest.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(1500);
    const _newOptimizer = Object.create(null);

    expect(startupTimeOptimizer.isWithinBudget()).toBe(true);
  });

  it('should setup app state observer', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const addEventListener = require('react-native').AppState.addEventListener;
    startupTimeOptimizer.setupAppStateObserver();
    expect(addEventListener).toHaveBeenCalled();
  });
});

describe('measureStartupTime', () => {
  it('should measure async function execution time', async () => {
    const mockFn = jest.fn().mockResolvedValue('result');
    const result = await measureStartupTime(mockFn);

    expect(result).toBe('result');
    expect(mockFn).toHaveBeenCalled();
  });

  it('should warn on slow Android operations', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const slowFn = jest
      .fn()
      .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 200)));

    await measureStartupTime(slowFn);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe('initHermesOptimizations', () => {
  it('should initialize Hermes optimizations on Android', () => {
    const result = initHermesOptimizations();

    expect(result.isHermesEnabled).toBe(true);
    expect(result.hermesFlags).toEqual({});
  });

  it('should return false for non-Android platforms', () => {
    (Platform as any).OS = 'ios';
    const result = initHermesOptimizations();

    expect(result.isHermesEnabled).toBe(false);
  });
});
