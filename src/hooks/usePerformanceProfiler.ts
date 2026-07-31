import { useEffect, useRef } from 'react';
import { performanceMonitor } from '../services/performanceMonitor';

interface PerformanceProfilerOptions {
  metadata?: Record<string, unknown>;
  trackMemory?: boolean;
  /** Track LCP for this screen — call when main content is ready */
  trackLCP?: boolean;
}

export const usePerformanceProfiler = (
  name: string,
  options: PerformanceProfilerOptions | Record<string, unknown> = {}
): void => {
  const renderStart = useRef<number>(Date.now());
  const renderCount = useRef(0);
  const lcpTracked = useRef(false);

  const normalizedOptions =
    'metadata' in options || 'trackMemory' in options || 'trackLCP' in options
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

    // Track LCP on first render only — this is when main content paints
    if (normalizedOptions.trackLCP && !lcpTracked.current) {
      lcpTracked.current = true;
      performanceMonitor.trackLCP(name);
    }

    renderStart.current = Date.now();
  });
};

/**
 * Hook that measures and reports FID (First Input Delay) for a handler.
 *
 * Wrap the handler you pass to `onPress`, `onChange`, etc. in the returned
 * `withFID` wrapper. The delay from the raw input event to the handler start
 * is tracked as a FID metric.
 *
 * @example
 * const { withFID } = useFIDTracker('SubscribeButton');
 * <Button onPress={withFID(handleSubscribe)} />
 */
export const useFIDTracker = (interactionName: string) => {
  const pressTime = useRef<number>(0);

  const withFID = <T extends (...args: unknown[]) => unknown>(handler: T): T => {
    return ((...args: unknown[]) => {
      const delayMs = pressTime.current > 0 ? Date.now() - pressTime.current : 0;
      if (delayMs > 0) {
        performanceMonitor.trackFID(interactionName, delayMs);
      }
      pressTime.current = 0;
      return handler(...args);
    }) as T;
  };

  /** Call this in the `onPressIn` or equivalent to record the input timestamp */
  const onInputStart = () => {
    pressTime.current = Date.now();
  };

  return { withFID, onInputStart };
};
