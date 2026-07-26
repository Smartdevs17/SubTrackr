import { useEffect, useRef } from 'react';
import { performanceMonitor } from '../services/performanceMonitor';

interface PerformanceProfilerOptions {
  metadata?: Record<string, unknown>;
  trackMemory?: boolean;
}

export const usePerformanceProfiler = (
  name: string,
  options: PerformanceProfilerOptions | Record<string, unknown> = {}
): void => {
  const renderStart = useRef<number>(Date.now());
  const renderCount = useRef(0);
  const normalizedOptions =
    'metadata' in options || 'trackMemory' in options
      ? (options as PerformanceProfilerOptions)
      : ({ metadata: options } as PerformanceProfilerOptions);

  useEffect(() => {
    renderCount.current += 1;
    const durationMs = Date.now() - renderStart.current;

    performanceMonitor.track({
      type: 'render',
      name,
      durationMs,
      timestamp: Date.now(),
      metadata: {
        renderCount: renderCount.current,
        ...normalizedOptions.metadata,
      },
    });

    if (normalizedOptions.trackMemory) {
      performanceMonitor.trackMemoryUsage(name);
    }

    renderStart.current = Date.now();
  });
};
