import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { spacing, typography, borderRadius } from '../../utils/constants';
import { useThemeColors } from '../../hooks/useThemeColors';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'crypto' | 'danger';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilitySelected?: boolean;
  testID?: string;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'medium',
  disabled = false,
  loading = false,
  fullWidth = false,
  style,
  accessibilityLabel,
  accessibilityHint,
  accessibilitySelected = false,
  testID,
}) => {
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  const buttonStyle = [
    styles.button,
    styles[variant],
    styles[size],
    fullWidth && styles.fullWidth,
    disabled && styles.disabled,
    style,
  ];

  const textStyle = [
    styles.text,
    styles[`${variant}Text`],
    styles[`${size}Text`],
    disabled && styles.disabledText,
  ];

  return (
    <TouchableOpacity
      style={buttonStyle}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
      accessibilityRole="button"
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{
        disabled: disabled || loading,
        busy: loading,
        selected: accessibilitySelected,
      }}>
      {loading ? (
        <ActivityIndicator
          color={variant === 'outline' ? colors.brand.primary : colors.onPrimary}
          size="small"
        />
      ) : (
        <Text style={textStyle}>{title}</Text>
      )}
    </TouchableOpacity>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    button: {
      borderRadius: borderRadius.md,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
    },
    primary: {
      backgroundColor: colors.brand.primary,
    },
    secondary: {
      backgroundColor: colors.brand.secondary,
    },
    outline: {
      borderWidth: 1,
      borderColor: colors.brand.primary,
    },
    crypto: {
      backgroundColor: colors.accent,
    },
    danger: {
      backgroundColor: colors.status.error,
    },
    small: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      minHeight: 36,
    },
    medium: {
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      minHeight: 48,
    },
    large: {
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.xl,
      minHeight: 56,
    },
    disabled: {
      opacity: 0.5,
    },
    fullWidth: {
      width: '100%',
    },
    text: {
      fontWeight: '600',
    },
    primaryText: {
      color: colors.onPrimary,
    },
    secondaryText: {
      color: colors.onSecondary,
    },
    outlineText: {
      color: colors.brand.primary,
    },
    cryptoText: {
      color: colors.onPrimary,
    },
    dangerText: {
      color: colors.onPrimary,
    },
    smallText: {
      ...typography.caption,
    },
    mediumText: {
      ...typography.body,
    },
    largeText: {
      ...typography.h3,
    },
    disabledText: {
      opacity: 0.7,
    },
  });
}
