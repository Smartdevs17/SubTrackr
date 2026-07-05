/**
 * Animation Design Tokens
 * Standardized durations and easing functions
 * Performance optimized for mobile platforms
 */

import type { AnimationTokens } from '../types/design-tokens';

/**
 * Animation timing in milliseconds
 * Optimized for mobile UX following Material Design guidelines
 */
export const animation: AnimationTokens = {
  duration: {
    fastest: 50, // Micro-interactions (ripple, indicator)
    fast: 150, // Transitions between states
    normal: 300, // Standard transitions (screens, modals)
    slow: 500, // Deliberate transitions (entrances, exits)
    slowest: 1000, // Long animations (progress, long transitions)
  },
  easing: {
    linear: 'linear',
    easeIn: 'ease-in',
    easeOut: 'ease-out',
    easeInOut: 'ease-in-out',
  },
};

/**
 * Common animation presets for specific interactions
 */
export const animationPresets = {
  // UI Transitions
  buttonPress: {
    duration: animation.duration.fast,
    easing: animation.easing.easeInOut,
  },
  fadeIn: {
    duration: animation.duration.normal,
    easing: animation.easing.easeIn,
  },
  fadeOut: {
    duration: animation.duration.normal,
    easing: animation.easing.easeOut,
  },
  slideIn: {
    duration: animation.duration.normal,
    easing: animation.easing.easeOut,
  },
  slideOut: {
    duration: animation.duration.normal,
    easing: animation.easing.easeIn,
  },
  scaleIn: {
    duration: animation.duration.normal,
    easing: animation.easing.easeOut,
  },
  scaleOut: {
    duration: animation.duration.normal,
    easing: animation.easing.easeIn,
  },

  // Modal/Dialog
  modalEnter: {
    duration: animation.duration.normal,
    easing: animation.easing.easeOut,
  },
  modalExit: {
    duration: animation.duration.fast,
    easing: animation.easing.easeIn,
  },

  // Loading states
  spinner: {
    duration: 1000,
    easing: animation.easing.linear,
  },
  pulse: {
    duration: animation.duration.slow,
    easing: animation.easing.easeInOut,
  },
  shimmer: {
    duration: 1500,
    easing: animation.easing.linear,
  },

  // Page transitions
  pageEnter: {
    duration: animation.duration.normal,
    easing: animation.easing.easeOut,
  },
  pageExit: {
    duration: animation.duration.normal,
    easing: animation.easing.easeIn,
  },

  // Toast/Notification
  toastEnter: {
    duration: animation.duration.fast,
    easing: animation.easing.easeOut,
  },
  toastExit: {
    duration: animation.duration.fast,
    easing: animation.easing.easeIn,
  },
} as const;

/**
 * Get animation preset configuration
 * @param preset - The animation preset key
 * @returns The animation configuration
 */
export function getAnimationPreset(preset: keyof typeof animationPresets): {
  duration: number;
  easing: string;
} {
  return animationPresets[preset];
}

/**
 * Get animation duration
 * @param speed - The animation speed ('fastest', 'fast', 'normal', 'slow', 'slowest')
 * @returns The duration in milliseconds
 */
export function getAnimationDuration(speed: keyof typeof animation.duration): number {
  return animation.duration[speed];
}

/**
 * Get easing function
 * @param easeType - The easing type
 * @returns The easing function name
 */
export function getEasing(easeType: keyof typeof animation.easing): string {
  return animation.easing[easeType];
}

/**
 * Create custom animation timing
 * @param duration - Duration in milliseconds
 * @param easing - Easing function
 * @returns Animation configuration object
 */
export function createAnimationTiming(
  duration: number,
  easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' = 'ease-in-out'
): {
  duration: number;
  easing: string;
} {
  return { duration, easing };
}
