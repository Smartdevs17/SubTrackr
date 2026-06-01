import React from 'react';
import { StyleProp, View, StyleSheet, ViewStyle } from 'react-native';
import { spacing, borderRadius, shadows } from '../../utils/constants';
import { useThemeColors } from '../../hooks/useThemeColors';

export interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  variant?: 'default' | 'elevated' | 'outlined';
  padding?: 'none' | 'small' | 'medium' | 'large';
}

export const Card: React.FC<CardProps> = ({
  children,
  style,
  variant = 'default',
  padding = 'medium',
}) => {
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  const getPaddingStyle = () => {
    switch (padding) {
      case 'none':
        return styles.paddingNone;
      case 'small':
        return styles.paddingSmall;
      case 'medium':
        return styles.paddingMedium;
      case 'large':
        return styles.paddingLarge;
      default:
        return styles.paddingMedium;
    }
  };

  const cardStyle = [styles.card, styles[variant], getPaddingStyle(), style];

  return <View style={cardStyle}>{children}</View>;
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.background.card,
      borderRadius: borderRadius.lg,
    },
    default: {
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    elevated: {
      ...shadows.md,
    },
    outlined: {
      borderWidth: 2,
      borderColor: colors.border.default,
    },
    paddingNone: {},
    paddingSmall: {
      padding: spacing.sm,
    },
    paddingMedium: {
      padding: spacing.md,
    },
    paddingLarge: {
      padding: spacing.lg,
    },
  });
}
