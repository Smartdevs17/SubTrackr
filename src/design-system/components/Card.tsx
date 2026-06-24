/**
 * Card Component
 * Container component for content grouping with multiple variants
 * WCAG 2.1 compliant with proper semantic structure
 */

import React from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import type { ViewStyle } from 'react-native';

import { spacing, borderRadius, shadows } from '../tokens';
import type { BaseComponentProps } from '../types/design-tokens';

// ============================================================================
// TYPES
// ============================================================================

export type CardVariant = 'default' | 'elevated' | 'outlined' | 'filled';

export interface CardProps extends BaseComponentProps {
  /**
   * Card content
   */
  children: React.ReactNode;

  /**
   * Card variant style
   * @default 'default'
   */
  variant?: CardVariant;

  /**
   * Padding amount
   * @default 'md'
   */
  padding?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';

  /**
   * Whether the card is pressable (interactive)
   * @default false
   */
  onPress?: () => void;

  /**
   * Custom container style
   */
  style?: ViewStyle;

  /**
   * Whether to apply platform-specific styling
   * @default true
   */
  platformSpecific?: boolean;
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  card: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },

  // Variants
  variantDefault: {
    borderWidth: 1,
  },

  variantElevated: {
    ...shadows.md,
  },

  variantOutlined: {
    borderWidth: 1,
  },

  variantFilled: {
    borderWidth: 0,
  },

  // Padding sizes
  paddingXs: {
    padding: spacing.xs,
  },
  paddingSm: {
    padding: spacing.sm,
  },
  paddingMd: {
    padding: spacing.md,
  },
  paddingLg: {
    padding: spacing.lg,
  },
  paddingXl: {
    padding: spacing.xl,
  },

  // Platform-specific for iOS
  ...Platform.select({
    ios: {
      cardIos: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
    },
    android: {
      cardAndroid: {
        elevation: 2,
      },
    },
    default: {},
  }),
});

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Card Component
 * Reusable container with multiple variants and styling options
 * Supports elevation, outlined, filled, and default variants
 */
export const Card = React.forwardRef<View, CardProps>(
  (
    {
      children,
      variant = 'default',
      padding = 'md',
      onPress,
      style,
      platformSpecific = true,
      accessibilityLabel,
      accessibilityRole,
      testID,
    },
    ref
  ) => {
    // Mock theme
    const theme = {
      colors: {
        border: '#334155',
        surface: '#1e293b',
        surfaceVariant: '#334155',
      },
    };

    // Variant-specific styles
    const variantStyle: ViewStyle = {
      backgroundColor:
        variant === 'filled' ? theme.colors.surfaceVariant : theme.colors.surface,
      borderColor:
        variant === 'outlined' || variant === 'default'
          ? theme.colors.border
          : undefined,
    };

    // Padding size
    const paddingStyle = {
      xs: styles.paddingXs,
      sm: styles.paddingSm,
      md: styles.paddingMd,
      lg: styles.paddingLg,
      xl: styles.paddingXl,
    }[padding];

    // Get variant styles
    const getVariantStyles = () => {
      switch (variant) {
        case 'elevated':
          return styles.variantElevated;
        case 'outlined':
          return styles.variantOutlined;
        case 'filled':
          return styles.variantFilled;
        default:
          return styles.variantDefault;
      }
    };

    // Platform-specific styles
    const platformStyles = platformSpecific
      ? Platform.select({
          ios: styles.cardIos,
          android: styles.cardAndroid,
          default: {},
        })
      : {};

    return (
      <View
        ref={ref}
        style={[
          styles.card,
          getVariantStyles(),
          paddingStyle,
          variantStyle,
          platformStyles,
          style,
        ]}
        onTouchEnd={onPress}
        accessible={!!accessibilityLabel || !!onPress}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole || 'none'}
        accessibilityHint={onPress ? 'Double tap to activate' : undefined}
        testID={testID}
      >
        {children}
      </View>
    );
  }
);

Card.displayName = 'Card';
