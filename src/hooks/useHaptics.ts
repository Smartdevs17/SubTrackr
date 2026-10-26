/**
 * useHaptics
 *
 * Centralised haptic feedback utility for SubTrackr.
 *
 * Feedback mapping
 * ─────────────────────────────────────────────────────────────────
 * triggerLight()    → ImpactFeedbackStyle.Light   (standard taps / button presses)
 * triggerMedium()   → ImpactFeedbackStyle.Medium  (confirmations / selections)
 * triggerHeavy()    → ImpactFeedbackStyle.Heavy   (destructive / high-impact actions)
 * triggerSuccess()  → NotificationFeedbackType.Success  (save / submit succeeded)
 * triggerError()    → NotificationFeedbackType.Error    (validation / network failure)
 * triggerWarning()  → NotificationFeedbackType.Warning  (caution prompts)
 *
 * All calls are fire-and-forget (void) so they never block the UI thread.
 * expo-haptics silently no-ops on platforms / devices that don't support
 * haptics (Android without vibrator, web, simulator), so no extra guards
 * are needed.
 */

import * as Haptics from 'expo-haptics';
import { useCallback } from 'react';

// ─── standalone helpers (usable outside React components) ────────────────────

/** Standard button press / list-item tap. */
export const triggerLightHaptic = (): void => {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
};

/** Confirmations, selections, toggles. */
export const triggerMediumHaptic = (): void => {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
};

/** Destructive actions (delete, force-cancel). */
export const triggerHeavyHaptic = (): void => {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
};

/** Successful save / submit / completion. */
export const triggerSuccessHaptic = (): void => {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
};

/** Validation error, network failure, rejected action. */
export const triggerErrorHaptic = (): void => {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
};

/** Non-blocking warning / caution prompt. */
export const triggerWarningHaptic = (): void => {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
};

// ─── React hook (memoised callbacks, safe to use in components) ──────────────

export interface UseHapticsReturn {
  /** Standard button press / list-item tap. */
  triggerLight: () => void;
  /** Confirmations, selections, toggles. */
  triggerMedium: () => void;
  /** Destructive actions (delete, force-cancel). */
  triggerHeavy: () => void;
  /** Successful save / submit / completion. */
  triggerSuccess: () => void;
  /** Validation error, network failure, rejected action. */
  triggerError: () => void;
  /** Non-blocking warning / caution prompt. */
  triggerWarning: () => void;
}

export function useHaptics(): UseHapticsReturn {
  const triggerLight = useCallback(triggerLightHaptic, []);
  const triggerMedium = useCallback(triggerMediumHaptic, []);
  const triggerHeavy = useCallback(triggerHeavyHaptic, []);
  const triggerSuccess = useCallback(triggerSuccessHaptic, []);
  const triggerError = useCallback(triggerErrorHaptic, []);
  const triggerWarning = useCallback(triggerWarningHaptic, []);

  return {
    triggerLight,
    triggerMedium,
    triggerHeavy,
    triggerSuccess,
    triggerError,
    triggerWarning,
  };
}

export default useHaptics;
