/**
 * RTL (Right-to-Left) Support Utilities
 * Handles directional layout adjustments for RTL languages
 */

import { I18nManager } from 'react-native';

export type TextDirection = 'ltr' | 'rtl';

/**
 * Get current text direction
 */
export const getTextDirection = (): TextDirection => {
  return I18nManager.isRTL ? 'rtl' : 'ltr';
};

/**
 * Check if RTL is enabled
 */
export const isRTL = (): boolean => I18nManager.isRTL;

/**
 * Get directional value (flips for RTL)
 * @param ltrValue - Value for LTR
 * @param rtlValue - Value for RTL
 */
export const getDirectionalValue = <T,>(
  ltrValue: T,
  rtlValue?: T
): T => {
  if (isRTL() && rtlValue !== undefined) {
    return rtlValue;
  }
  return ltrValue;
};

/**
 * Get directional margins
 * Returns start/end margins that respect RTL
 */
export const getDirectionalMargin = (
  start: number,
  end?: number
): { marginStart: number; marginEnd: number } => {
  return {
    marginStart: start,
    marginEnd: end ?? start,
  };
};

/**
 * Get directional padding
 * Returns start/end padding that respects RTL
 */
export const getDirectionalPadding = (
  start: number,
  end?: number
): { paddingStart: number; paddingEnd: number } => {
  return {
    paddingStart: start,
    paddingEnd: end ?? start,
  };
};

/**
 * Flip horizontal position for RTL
 */
export const flipHorizontal = (value: number): number => {
  return isRTL() ? -value : value;
};
