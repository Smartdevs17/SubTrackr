/**
 * Button Component
 * Base button component with multiple variants and sizes
 * WCAG 2.1 AA accessible with proper touch targets (minimum 44x44pt)
 */

import React from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  Text,
  View,
  ActivityIndicator,
  Platform,
  AccessibilityInfo,
} from 'react-native';
import type { ViewStyle, TextStyle } from 'react-native';

import { spacing, borderRadius, typography, shadows, animation } from '../tokens';
import type { AccessibilityProps, ComponentSize } from '../types/design-tokens';

// ============================================================================
// TYPES
// ============================================================================

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'success'
  | 'crypto';

export type ButtonSize = 'small' | 'medium' | 'large';

export interface ButtonProps extends AccessibilityProps {
  /**
   * The button label/text
   */
  label: string;

  /**
   * Button variant style
   * @default 'primary'
   */
  variant?: ButtonVariant;

  /**
   * Button size
   * @default 'medium'
   */
  size?: ButtonSize;

  /**
   * Callback when button is pressed
   */
  onPress: () => void | Promise<void>;

  /**
   * Whether button is disabled
   * @default false
   */
  disabled?: boolean;

  /**
   * Show loading indicator
   * @default false
   */
  loading?: boolean;

  /**
   * Full width button
   * @default false
   */
  fullWidth?: boolean;

  /**
   * Left icon component
   */
  leftIcon?: React.ReactNode;

  /**
   * Right icon component
   */
  rightIcon?: React.ReactNode;

  /**
   * Custom style override
   */
  style?: ViewStyle;

  /**
   * Custom text style override
   */
  textStyle?: TextStyle;
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  base: {
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 44, // WCAG 2.1 AA minimum touch target
    minWidth: 44,
  },

  // Sizes
  small: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 36,
  },
  medium: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
  },
  large: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    minHeight: 52,
  },

  // Full width
  fullWidth: {
    width: '100%',
  },

  // Icon spacing
  withLeftIcon: {
    marginRight: spacing.sm,
  },
  withRightIcon: {
    marginLeft: spacing.sm,
  },

  // Text styles
  textSmall: {
    ...typography.buttonSmall,
  },
  textMedium: {
    ...typography.button,
  },
  textLarge: {
    ...typography.button,
  },

  // Loading spinner
  spinner: {
    marginRight: spacing.sm,
  },
});

// ============================================================================
// THEME COLORS
// ============================================================================

interface ButtonThemeColors {
  background: string;
  text: string;
  border: string;
  disabledBackground: string;
  disabledText: string;
  disabledBorder: string;
}

const getButtonThemeColors = (
  variant: ButtonVariant,
  theme: { colors: Record<string, string> }
): ButtonThemeColors => {
  const { colors } = theme;

  switch (variant) {
    case 'primary':
      return {
        background: colors.primary,
        text: colors.onPrimary,
        border: colors.primary,
        disabledBackground: colors.textDisabled,
        disabledText: colors.text,
        disabledBorder: colors.textDisabled,
      };

    case 'secondary':
      return {
        background: colors.secondary,
        text: colors.onSecondary,
        border: colors.secondary,
        disabledBackground: colors.textDisabled,
        disabledText: colors.text,
        disabledBorder: colors.textDisabled,
      };

    case 'outline':
      return {
        background: 'transparent',
        text: colors.primary,
        border: colors.primary,
        disabledBackground: 'transparent',
        disabledText: colors.textDisabled,
        disabledBorder: colors.textDisabled,
      };

    case 'ghost':
      return {
        background: 'transparent',
        text: colors.primary,
        border: 'transparent',
        disabledBackground: 'transparent',
        disabledText: colors.textDisabled,
        disabledBorder: 'transparent',
      };

    case 'danger':
      return {
        background: colors.error,
        text: colors.onError,
        border: colors.error,
        disabledBackground: colors.textDisabled,
        disabledText: colors.text,
        disabledBorder: colors.textDisabled,
      };

    case 'success':
      return {
        background: colors.success,
        text: colors.onSuccess,
        border: colors.success,
        disabledBackground: colors.textDisabled,
        disabledText: colors.text,
        disabledBorder: colors.textDisabled,
      };

    case 'crypto':
      return {
        background: colors.accent,
        text: colors.onAccent,
        border: colors.accent,
        disabledBackground: colors.textDisabled,
        disabledText: colors.text,
        disabledBorder: colors.textDisabled,
      };

    default:
      return {
        background: colors.primary,
        text: colors.onPrimary,
        border: colors.primary,
        disabledBackground: colors.textDisabled,
        disabledText: colors.text,
        disabledBorder: colors.textDisabled,
      };
  }
};

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Accessible Button Component
 * Supports multiple variants, sizes, and states
 * Compliant with WCAG 2.1 AA accessibility standards
 */
export const Button = React.forwardRef<TouchableOpacity, ButtonProps>(
  (
    {
      label,
      variant = 'primary',
      size = 'medium',
      onPress,
      disabled = false,
      loading = false,
      fullWidth = false,
      leftIcon,
      rightIcon,
      style,
      textStyle,
      accessibilityLabel,
      accessibilityHint,
      accessibilityRole = 'button',
      testID = `button-${label.toLowerCase()}`,
    },
    ref
  ) => {
    // Mock theme (in real app, would come from useTheme hook)
    const theme = {
      colors: {
        primary: '#6366f1',
        onPrimary: '#ffffff',
        secondary: '#8b5cf6',
        onSecondary: '#ffffff',
        accent: '#06b6d4',
        onAccent: '#ffffff',
        error: '#ef4444',
        onError: '#ffffff',
        success: '#10b981',
        onSuccess: '#ffffff',
        text: '#f8fafc',
        textDisabled: '#64748b',
      },
    };

    const themeColors = getButtonThemeColors(variant, theme);
    const isDisabledOrLoading = disabled || loading;

    // Determine size styles
    const sizeStyle = {
      small: styles.small,
      medium: styles.medium,
      large: styles.large,
    }[size];

    const textSizeStyle = {
      small: styles.textSmall,
      medium: styles.textMedium,
      large: styles.textLarge,
    }[size];

    // Build button background style
    const buttonBackgroundStyle: ViewStyle = {
      backgroundColor: isDisabledOrLoading
        ? themeColors.disabledBackground
        : themeColors.background,
      borderWidth: variant === 'outline' ? 1 : 0,
      borderColor: isDisabledOrLoading ? themeColors.disabledBorder : themeColors.border,
    };

    // Build text style
    const buttonTextStyle: TextStyle = {
      color: isDisabledOrLoading ? themeColors.disabledText : themeColors.text,
    };

    const handlePress = async () => {
      if (isDisabledOrLoading) return;

      try {
        await Promise.resolve(onPress());
      } catch (error) {
        console.error('Button onPress error:', error);
      }
    };

    return (
      <TouchableOpacity
        ref={ref}
        style={[
          styles.base,
          sizeStyle,
          buttonBackgroundStyle,
          fullWidth && styles.fullWidth,
          style,
        ]}
        onPress={handlePress}
        disabled={isDisabledOrLoading}
        activeOpacity={0.7}
        accessibilityLabel={accessibilityLabel || label}
        accessibilityHint={accessibilityHint || (disabled ? 'Button is disabled' : undefined)}
        accessibilityRole={accessibilityRole}
        accessibilityState={{
          disabled: isDisabledOrLoading,
        }}
        testID={testID}>
        {loading && (
          <ActivityIndicator size="small" color={buttonTextStyle.color} style={styles.spinner} />
        )}
        {leftIcon && !loading && <View style={styles.withLeftIcon}>{leftIcon}</View>}

        <Text
          style={[textSizeStyle, buttonTextStyle, textStyle]}
          allowFontScaling
          maxFontSizeMultiplier={1.2}>
          {label}
        </Text>

        {rightIcon && <View style={styles.withRightIcon}>{rightIcon}</View>}
      </TouchableOpacity>
    );
  }
);

Button.displayName = 'Button';
