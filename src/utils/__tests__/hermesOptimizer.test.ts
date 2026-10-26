import { hermesOptimizer } from '../../utils/hermesOptimizer';
import { Platform } from 'react-native';

describe('hermesOptimizer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should detect Android platform for optimizations', () => {
    (Platform as any).OS = 'android';
    expect(hermesOptimizer.isEnabled()).toBe(true);

    (Platform as any).OS = 'ios';
    expect(hermesOptimizer.isEnabled()).toBe(false);
  });

  it('should return precompile modules list', () => {
    const modules = hermesOptimizer.getPrecompiledModules();

    expect(modules).toContain('src/store');
    expect(modules).toContain('src/i18n');
    expect(modules).toContain('src/services/auth/session');
    expect(modules).toContain('src/navigation');
  });

  it('should identify critical modules for precompilation', () => {
    expect(hermesOptimizer.shouldPrecompile('src/store/subscriptionStore')).toBe(true);
    expect(hermesOptimizer.shouldPrecompile('src/services/auth/session')).toBe(true);
    expect(hermesOptimizer.shouldPrecompile('src/components/button')).toBe(false);
  });

  it('should return Hermes configuration flags', () => {
    const flags = hermesOptimizer.configureHermesFlags();

    expect(flags.inlineBooleanEval).toBe(true);
    expect(flags.inlineSourceMap).toBe(true);
    expect(flags.allocationProfile).toBe(true);
    expect(flags.maxNumTemp).toBe(65536);
  });

  it('should return memory optimization config', () => {
    const config = hermesOptimizer.getMemoryOptimizationConfig();

    expect(config.heapSize).toBe('64MB');
    expect(config.gcThreshold).toBe(0.8);
    expect(config.concurrentGC).toBe(true);
  });

  it('should initialize without errors', async () => {
    await expect(hermesOptimizer.initialize()).resolves.not.toThrow();
  });
});
