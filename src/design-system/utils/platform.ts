/**
 * Platform Detection Utilities
 * Handles platform-specific logic for iOS, Android, and Web
 */

import { Platform } from 'react-native';

export type PlatformType = 'ios' | 'android' | 'web' | 'unknown';

/**
 * Get the current platform
 */
export const getCurrentPlatform = (): PlatformType => {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  if (Platform.OS === 'web') return 'web';
  return 'unknown';
};

/**
 * Check if platform is iOS
 */
export const isIOS = (): boolean => Platform.OS === 'ios';

/**
 * Check if platform is Android
 */
export const isAndroid = (): boolean => Platform.OS === 'android';

/**
 * Check if platform is Web
 */
export const isWeb = (): boolean => Platform.OS === 'web';

/**
 * Get platform-specific value
 */
export const getPlatformValue = <T>(
  iosValue: T,
  androidValue: T,
  webValue?: T,
  defaultValue?: T
): T => {
  if (Platform.OS === 'ios') return iosValue;
  if (Platform.OS === 'android') return androidValue;
  if (Platform.OS === 'web' && webValue) return webValue;
  return defaultValue || androidValue;
};
