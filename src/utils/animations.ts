import React from 'react';
import { Animated, Easing, ViewStyle } from 'react-native';

// Animation configurations
export const animationConfig = {
  duration: {
    fast: 200,
    normal: 300,
    slow: 500,
  },
  easing: {
    easeInOut: Easing.inOut(Easing.ease),
    easeOut: Easing.out(Easing.ease),
    easeIn: Easing.in(Easing.ease),
    bounce: Easing.bounce,
    elastic: Easing.elastic(1),
  },
};

// Shared element transition utilities
export class SharedElementTransition {
  private static transitions = new Map<string, Animated.Value>();

  static register(id: string, initialValue: number = 0): Animated.Value {
    if (!this.transitions.has(id)) {
      this.transitions.set(id, new Animated.Value(initialValue));
    }
    return this.transitions.get(id)!;
  }

  static get(id: string): Animated.Value | undefined {
    return this.transitions.get(id);
  }

  static unregister(id: string): void {
    this.transitions.delete(id);
  }
}

// Animation presets
export const animations = {
  fadeIn: (animatedValue: Animated.Value, duration: number = animationConfig.duration.normal) => {
    return Animated.timing(animatedValue, {
      toValue: 1,
      duration,
      easing: animationConfig.easing.easeOut,
      useNativeDriver: true,
    });
  },

  fadeOut: (animatedValue: Animated.Value, duration: number = animationConfig.duration.normal) => {
    return Animated.timing(animatedValue, {
      toValue: 0,
      duration,
      easing: animationConfig.easing.easeIn,
      useNativeDriver: true,
    });
  },

  slideInFromRight: (
    animatedValue: Animated.Value,
    duration: number = animationConfig.duration.normal
  ) => {
    return Animated.timing(animatedValue, {
      toValue: 0,
      duration,
      easing: animationConfig.easing.easeOut,
      useNativeDriver: true,
    });
  },

  slideOutToRight: (
    animatedValue: Animated.Value,
    duration: number = animationConfig.duration.normal
  ) => {
    return Animated.timing(animatedValue, {
      toValue: 1,
      duration,
      easing: animationConfig.easing.easeIn,
      useNativeDriver: true,
    });
  },

  scaleIn: (animatedValue: Animated.Value) => {
    return Animated.spring(animatedValue, {
      toValue: 1,
      tension: 100,
      friction: 8,
      useNativeDriver: true,
    });
  },

  scaleOut: (animatedValue: Animated.Value, duration: number = animationConfig.duration.normal) => {
    return Animated.timing(animatedValue, {
      toValue: 0,
      duration,
      easing: animationConfig.easing.easeIn,
      useNativeDriver: true,
    });
  },

  bounce: (animatedValue: Animated.Value) => {
    return Animated.sequence([
      Animated.spring(animatedValue, {
        toValue: 1.2,
        tension: 200,
        friction: 3,
        useNativeDriver: true,
      }),
      Animated.spring(animatedValue, {
        toValue: 1,
        tension: 200,
        friction: 3,
        useNativeDriver: true,
      }),
    ]);
  },

  pulse: (animatedValue: Animated.Value) => {
    return Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 1.1,
          duration: 500,
          easing: animationConfig.easing.easeInOut,
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: 1,
          duration: 500,
          easing: animationConfig.easing.easeInOut,
          useNativeDriver: true,
        }),
      ])
    );
  },
};

// Animation hooks
export const useAnimatedValue = (initialValue: number = 0): Animated.Value => {
  return React.useRef(new Animated.Value(initialValue)).current;
};

export const useAnimatedValues = (count: number, initialValue: number = 0): Animated.Value[] => {
  return React.useMemo(
    () => Array.from({ length: count }, () => new Animated.Value(initialValue)),
    [count, initialValue]
  );
};

// Stagger animation utility
export const stagger = (
  animations: Animated.CompositeAnimation[],
  staggerDelay: number = 100
): Animated.CompositeAnimation => {
  return Animated.stagger(staggerDelay, animations);
};

// Parallel animation utility
export const parallel = (
  animations: Animated.CompositeAnimation[]
): Animated.CompositeAnimation => {
  return Animated.parallel(animations);
};

// Sequence animation utility
export const sequence = (
  animations: Animated.CompositeAnimation[]
): Animated.CompositeAnimation => {
  return Animated.sequence(animations);
};

// Interpolation utilities
export const interpolate = (
  animatedValue: Animated.Value,
  inputRange: number[],
  outputRange: number[] | string[]
): Animated.AnimatedInterpolation<string | number> => {
  return animatedValue.interpolate({
    inputRange,
    outputRange,
  });
};

// Combined style creators
export const createAnimatedStyle = {
  fade: (animatedValue: Animated.Value): Animated.WithAnimatedObject<ViewStyle> => ({
    opacity: animatedValue,
  }),

  scale: (animatedValue: Animated.Value): Animated.WithAnimatedObject<ViewStyle> => ({
    transform: [{ scale: animatedValue }],
  }),

  translateX: (
    animatedValue: Animated.Value,
    range: [number, number] = [-100, 0]
  ): Animated.WithAnimatedObject<ViewStyle> => ({
    transform: [{ translateX: interpolate(animatedValue, [0, 1], range) }],
  }),

  translateY: (
    animatedValue: Animated.Value,
    range: [number, number] = [-100, 0]
  ): Animated.WithAnimatedObject<ViewStyle> => ({
    transform: [{ translateY: interpolate(animatedValue, [0, 1], range) }],
  }),

  slideFromRight: (animatedValue: Animated.Value): Animated.WithAnimatedObject<ViewStyle> => ({
    transform: [{ translateX: interpolate(animatedValue, [0, 1], [300, 0]) }],
    opacity: interpolate(animatedValue, [0, 1], [0, 1]),
  }),

  slideFromLeft: (animatedValue: Animated.Value): Animated.WithAnimatedObject<ViewStyle> => ({
    transform: [{ translateX: interpolate(animatedValue, [0, 1], [-300, 0]) }],
    opacity: interpolate(animatedValue, [0, 1], [0, 1]),
  }),

  slideFromBottom: (animatedValue: Animated.Value): Animated.WithAnimatedObject<ViewStyle> => ({
    transform: [{ translateY: interpolate(animatedValue, [0, 1], [300, 0]) }],
    opacity: interpolate(animatedValue, [0, 1], [0, 1]),
  }),

  slideFromTop: (animatedValue: Animated.Value): Animated.WithAnimatedObject<ViewStyle> => ({
    transform: [{ translateY: interpolate(animatedValue, [0, 1], [-300, 0]) }],
    opacity: interpolate(animatedValue, [0, 1], [0, 1]),
  }),

  scaleAndFade: (animatedValue: Animated.Value): Animated.WithAnimatedObject<ViewStyle> => ({
    transform: [{ scale: interpolate(animatedValue, [0, 1], [0.8, 1]) }],
    opacity: animatedValue,
  }),

  bounceScale: (animatedValue: Animated.Value): Animated.WithAnimatedObject<ViewStyle> => ({
    transform: [{ scale: interpolate(animatedValue, [0, 1], [0, 1.2]) }],
  }),
};
