import { useEffect, useRef } from 'react';
import { performanceMonitor } from '../services/performanceMonitor';

export const usePerformanceProfiler = (name: string, metadata?: Record<string, unknown>): void => {
  const start = useRef<number>(Date.now());

  useEffect(() => {
    const durationMs = Date.now() - start.current;
    performanceMonitor.track({
      type: 'render',
      name,
      durationMs,
      timestamp: Date.now(),
      metadata,
    });

    start.current = Date.now();
  });
};
