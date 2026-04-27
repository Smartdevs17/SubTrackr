import React, { useEffect, useRef, useCallback } from 'react';
import { Animated, InteractionManager } from 'react-native';

interface UseAnimationPerformanceOptions {
  useNativeDriver?: boolean;
  shouldRasterizeIOS?: boolean;
  enableInteractionManager?: boolean;
}

export const useAnimationPerformance = (
  animation: Animated.CompositeAnimation,
  options: UseAnimationPerformanceOptions = {}
) => {
  const { enableInteractionManager = false } = options;

  const animationRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    animationRef.current = animation;
  }, [animation]);

  const startAnimation = useCallback(() => {
    if (enableInteractionManager) {
      InteractionManager.runAfterInteractions(() => {
        animationRef.current?.start();
      });
    } else {
      animationRef.current?.start();
    }
  }, [enableInteractionManager]);

  const stopAnimation = useCallback(() => {
    animationRef.current?.stop();
  }, []);

  const resetAnimation = useCallback(() => {
    animationRef.current?.reset();
  }, []);

  useEffect(() => {
    return () => {
      animationRef.current?.stop();
    };
  }, []);

  return {
    startAnimation,
    stopAnimation,
    resetAnimation,
  };
};

// Animation batching utility to prevent layout thrashing
export class AnimationBatch {
  private animations: Animated.CompositeAnimation[] = [];
  private isRunning = false;

  add(animation: Animated.CompositeAnimation): void {
    this.animations.push(animation);
  }

  start(): void {
    if (this.isRunning || this.animations.length === 0) return;

    this.isRunning = true;

    // Use InteractionManager to ensure animations run after interactions
    InteractionManager.runAfterInteractions(() => {
      Animated.parallel(this.animations).start(() => {
        this.isRunning = false;
        this.animations = [];
      });
    });
  }

  stop(): void {
    this.animations.forEach((anim) => anim.stop());
    this.animations = [];
    this.isRunning = false;
  }

  clear(): void {
    this.animations = [];
  }
}

// Performance monitoring hook for animations
export const useAnimationMetrics = () => {
  const frameCountRef = useRef(0);
  const startTimeRef = useRef(0);
  const frameTimeRef = useRef(0);

  const startMonitoring = useCallback(() => {
    frameCountRef.current = 0;
    startTimeRef.current = Date.now();
    frameTimeRef.current = 0;
  }, []);

  const recordFrame = useCallback(() => {
    frameCountRef.current += 1;
    frameTimeRef.current = Date.now();
  }, []);

  const getMetrics = useCallback(() => {
    const totalTime = Date.now() - startTimeRef.current;
    const fps = frameCountRef.current / (totalTime / 1000);

    return {
      fps: Math.round(fps),
      frameCount: frameCountRef.current,
      totalTime,
      averageFrameTime: totalTime / frameCountRef.current,
    };
  }, []);

  return {
    startMonitoring,
    recordFrame,
    getMetrics,
  };
};

// Optimized value change animation with debouncing
export const useDebouncedAnimation = (
  value: number,
  animationCreator: (value: number) => Animated.CompositeAnimation,
  delay: number = 300
) => {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const lastValueRef = useRef(value);

  useEffect(() => {
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;

      // Clear existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Stop existing animation
      if (animationRef.current) {
        animationRef.current.stop();
      }

      // Start new animation after delay
      timeoutRef.current = setTimeout(() => {
        animationRef.current = animationCreator(value);
        animationRef.current.start();
      }, delay);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (animationRef.current) {
        animationRef.current.stop();
      }
    };
  }, [value, animationCreator, delay]);
};

// Memory-efficient animation pool
export class AnimationPool {
  private static pool = new Map<string, Animated.Value[]>();

  static get(key: string, size: number): Animated.Value[] {
    if (!this.pool.has(key)) {
      this.pool.set(
        key,
        Array.from({ length: size }, () => new Animated.Value(0))
      );
    }

    const values = this.pool.get(key)!;
    // Reset all values
    values.forEach((value) => value.setValue(0));
    return values;
  }

  static release(key: string): void {
    // Values are kept for reuse, just reset them
    const values = this.pool.get(key);
    if (values) {
      values.forEach((value) => value.setValue(0));
    }
  }

  static clear(): void {
    this.pool.clear();
  }
}

// Low-power mode animation adjustments
export const usePowerAwareAnimation = () => {
  const [isLowPower, setIsLowPower] = React.useState(false);

  useEffect(() => {
    // In a real implementation, you'd check device power state
    // For now, we'll use a simple heuristic
    const checkPowerMode = () => {
      // This would typically check battery level, thermal state, etc.
      setIsLowPower(false); // Default to false for demo
    };

    checkPowerMode();
  }, []);

  const getOptimizedConfig = useCallback(
    (baseConfig: any) => {
      if (isLowPower) {
        return {
          ...baseConfig,
          duration: Math.max(baseConfig.duration * 0.7, 150), // Reduce duration but keep minimum
          useNativeDriver: true, // Prefer native driver for better performance
        };
      }
      return baseConfig;
    },
    [isLowPower]
  );

  return {
    isLowPower,
    getOptimizedConfig,
  };
};
