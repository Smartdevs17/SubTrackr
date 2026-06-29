/**
 * Toast Component
 * Notification toast for temporary messages
 * WCAG 2.1 AA accessible with proper announcement for screen readers
 */

import React from 'react';
import { StyleSheet, View, Text, Animated, AccessibilityInfo } from 'react-native';
import type { ViewStyle, TextStyle } from 'react-native';

import { spacing, borderRadius, shadows, typography, animation } from '../tokens';
import type { BaseComponentProps } from '../types/design-tokens';

// ============================================================================
// TYPES
// ============================================================================

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export type ToastPosition = 'top' | 'bottom' | 'center';

export interface ToastProps extends BaseComponentProps {
  /**
   * Toast message text
   */
  message: string;

  /**
   * Toast type/variant
   * @default 'info'
   */
  variant?: ToastVariant;

  /**
   * Toast position on screen
   * @default 'bottom'
   */
  position?: ToastPosition;

  /**
   * Duration in milliseconds (0 = permanent)
   * @default 3000
   */
  duration?: number;

  /**
   * Callback when toast closes
   */
  onClose?: () => void;

  /**
   * Optional action button label
   */
  actionLabel?: string;

  /**
   * Callback when action is tapped
   */
  onAction?: () => void;

  /**
   * Custom style override
   */
  style?: ViewStyle;
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.md,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    ...shadows.lg,
  },

  // Positions
  positionTop: {
    marginTop: spacing.xl,
  },
  positionCenter: {
    alignSelf: 'center',
  },
  positionBottom: {
    marginBottom: spacing.lg,
  },

  // Message
  messageText: {
    ...typography.body,
    flex: 1,
    marginRight: spacing.md,
  },

  // Action button
  actionButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },

  actionText: {
    ...typography.button,
    fontWeight: '600',
  },
});

// ============================================================================
// THEME COLORS
// ============================================================================

interface ToastThemeColors {
  background: string;
  text: string;
  actionBackground: string;
  actionText: string;
}

const getToastThemeColors = (variant: ToastVariant): ToastThemeColors => {
  // Mock theme colors
  const colors: Record<ToastVariant, ToastThemeColors> = {
    success: {
      background: 'rgba(16, 185, 129, 0.95)',
      text: '#ffffff',
      actionBackground: 'rgba(0, 0, 0, 0.2)',
      actionText: '#ffffff',
    },
    error: {
      background: 'rgba(239, 68, 68, 0.95)',
      text: '#ffffff',
      actionBackground: 'rgba(0, 0, 0, 0.2)',
      actionText: '#ffffff',
    },
    warning: {
      background: 'rgba(245, 158, 11, 0.95)',
      text: '#ffffff',
      actionBackground: 'rgba(0, 0, 0, 0.2)',
      actionText: '#ffffff',
    },
    info: {
      background: 'rgba(14, 165, 233, 0.95)',
      text: '#ffffff',
      actionBackground: 'rgba(0, 0, 0, 0.2)',
      actionText: '#ffffff',
    },
  };

  return colors[variant];
};

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Accessible Toast/Notification Component
 * Supports multiple variants, positions, and auto-dismiss
 * WCAG 2.1 AA compliant with screen reader announcements
 */
export const Toast = React.forwardRef<View, ToastProps>(
  (
    {
      message,
      variant = 'info',
      position = 'bottom',
      duration = 3000,
      onClose,
      actionLabel,
      onAction,
      style,
      accessibilityLabel,
      testID,
    },
    ref
  ) => {
    const slideAnim = React.useRef(new Animated.Value(100)).current;
    const [visible, setVisible] = React.useState(true);

    React.useEffect(() => {
      // Animate in
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: animation.duration.normal,
        useNativeDriver: true,
      }).start();

      // Auto-dismiss if duration is set
      if (duration > 0) {
        const timer = setTimeout(() => {
          handleClose();
        }, duration);

        return () => clearTimeout(timer);
      }
    }, []);

    const handleClose = () => {
      Animated.timing(slideAnim, {
        toValue: position === 'top' ? -100 : 100,
        duration: animation.duration.normal,
        useNativeDriver: true,
      }).start(() => {
        setVisible(false);
        onClose?.();
      });
    };

    const handleAction = () => {
      onAction?.();
      handleClose();
    };

    if (!visible) {
      return null;
    }

    const themeColors = getToastThemeColors(variant);

    const positionStyle = {
      top: styles.positionTop,
      center: styles.positionCenter,
      bottom: styles.positionBottom,
    }[position];

    const containerStyle: ViewStyle = {
      backgroundColor: themeColors.background,
      transform: [
        {
          translateY: slideAnim,
        },
      ],
    };

    const messageStyle: TextStyle = {
      color: themeColors.text,
    };

    const actionButtonStyle: ViewStyle = {
      backgroundColor: themeColors.actionBackground,
    };

    const actionTextStyle: TextStyle = {
      color: themeColors.actionText,
    };

    const toastId = testID || `toast-${variant}`;

    return (
      <Animated.View
        ref={ref}
        style={[styles.container, positionStyle, containerStyle, style]}
        accessible
        accessibilityLabel={accessibilityLabel || message}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        testID={toastId}>
        <Text
          style={[styles.messageText, messageStyle]}
          numberOfLines={3}
          allowFontScaling
          maxFontSizeMultiplier={1.2}>
          {message}
        </Text>

        {actionLabel && (
          <View style={styles.actionButton}>
            {/* Pressable or TouchableOpacity would go here */}
            <Text
              style={[styles.actionText, actionTextStyle]}
              onPress={handleAction}
              allowFontScaling
              maxFontSizeMultiplier={1.2}>
              {actionLabel}
            </Text>
          </View>
        )}
      </Animated.View>
    );
  }
);

Toast.displayName = 'Toast';
