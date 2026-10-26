import { Platform, AppState } from 'react-native';

interface StartupMetrics {
  startTime: number;
  endTime?: number;
  jsEngineReady?: number;
  hermesBytecodeReady?: number;
  totalStartupMs?: number;
}

class StartupTimeOptimizer {
  private metrics: StartupMetrics = { startTime: Date.now() };
  private observers: (() => void)[] = [];

  markJsEngineReady() {
    if (Platform.OS !== 'android') return;
    this.metrics.jsEngineReady = Date.now() - this.metrics.startTime;
  }

  markHermesBytecodeReady() {
    if (Platform.OS !== 'android') return;
    this.metrics.hermesBytecodeReady = Date.now() - this.metrics.startTime;
  }

  markAppReady() {
    this.metrics.endTime = Date.now();
    this.metrics.totalStartupMs = this.metrics.endTime - this.metrics.startTime;
  }

  getMetrics(): StartupMetrics {
    return { ...this.metrics };
  }

  isWithinBudget(): boolean {
    const targetMs = 2000;
    return (this.metrics.totalStartupMs ?? Infinity) <= targetMs;
  }

  setupAppStateObserver() {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !this.metrics.endTime) {
        this.markAppReady();
      }
    });
    this.observers.push(() => subscription.remove());
  }

  cleanup() {
    this.observers.forEach((remove) => remove());
  }
}

export const startupTimeOptimizer = new StartupTimeOptimizer();

export const measureStartupTime = async <T>(fn: () => Promise<T>): Promise<T> => {
  const start = Date.now();
  try {
    const result = await fn();
    const duration = Date.now() - start;
    if (Platform.OS === 'android' && duration > 100) {
      console.warn(`[Performance] Slow startup operation: ${duration}ms`);
    }
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    console.error(`[Performance] Startup operation failed after ${duration}ms`, error);
    throw error;
  }
};

export const initHermesOptimizations = () => {
  if (Platform.OS !== 'android') return { isHermesEnabled: false };

  startupTimeOptimizer.setupAppStateObserver();

  const hermesInternal = (global as any).HermesInternal;
  const hermesFlags = hermesInternal?.getInstrumentedFlags?.() ?? {};
  const isHermesEnabled = !!hermesInternal;

  if (__DEV__) {
    console.info('[Hermes] Optimizations initialized', {
      isHermesEnabled,
      flags: hermesFlags,
    });
  }

  return { isHermesEnabled, hermesFlags };
};
