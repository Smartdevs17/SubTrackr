import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Hook for announcing screen reader messages
 * Useful for announcing state changes, errors, or important updates
 */
export function useAccessibilityAnnouncement() {
  const announcementRef = useRef<string>('');

  const announce = (message: string, delay: number = 0) => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      if (delay > 0) {
        setTimeout(() => {
          AccessibilityInfo.announceForAccessibility(message);
        }, delay);
      } else {
        AccessibilityInfo.announceForAccessibility(message);
      }
    }
  };

  const announceIfChanged = (message: string) => {
    if (message !== announcementRef.current) {
      announcementRef.current = message;
      announce(message);
    }
  };

  return { announce, announceIfChanged };
}

/**
 * Hook to announce when a value changes
 */
export function useAnnounceOnChange(value: any, message: string | ((value: any) => string)) {
  const { announce } = useAccessibilityAnnouncement();
  const prevValueRef = useRef(value);

  useEffect(() => {
    if (value !== prevValueRef.current) {
      const announcementMessage = typeof message === 'function' ? message(value) : message;
      announce(announcementMessage);
      prevValueRef.current = value;
    }
  }, [value, message, announce]);
}
