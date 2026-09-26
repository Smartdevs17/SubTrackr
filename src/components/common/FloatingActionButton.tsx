import React, { useCallback } from 'react';
import { TouchableOpacity, Text, StyleSheet, ViewStyle } from 'react-native';
import { spacing, typography, borderRadius, shadows } from '../../utils/constants';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useHaptics } from '../../hooks/useHaptics';

export interface FloatingActionButtonProps {
  onPress: () => void;
  icon?: string;
  title?: string;
  style?: ViewStyle;
  size?: 'small' | 'medium' | 'large';
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

export const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({
  onPress,
  icon = '+',
  title,
  style,
  size = 'medium',
  accessibilityLabel,
  accessibilityHint,
  testID,
}) => {
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const { triggerMedium } = useHaptics();
  const buttonStyle = [styles.button, styles[size], style];

  const handlePress = useCallback(() => {
    triggerMedium();
    onPress();
  }, [onPress, triggerMedium]);

  return (
    <TouchableOpacity
      style={buttonStyle}
      onPress={handlePress}
      activeOpacity={0.8}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title ?? 'Add item'}
      accessibilityHint={accessibilityHint ?? 'Activates the primary action'}>
      <Text style={[styles.icon, styles[`${size}Icon`]]}>{icon}</Text>
      {title && <Text style={[styles.title, styles[`${size}Title`]]}>{title}</Text>}
    </TouchableOpacity>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    button: {
      position: 'absolute',
      backgroundColor: colors.brand.primary,
      borderRadius: borderRadius.full,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadows.lg,
    },
    small: {
      width: 48,
      height: 48,
      bottom: spacing.lg,
      right: spacing.lg,
    },
    medium: {
      width: 56,
      height: 56,
      bottom: spacing.lg,
      right: spacing.lg,
    },
    large: {
      width: 64,
      height: 64,
      bottom: spacing.lg,
      right: spacing.lg,
    },
    icon: {
      color: colors.onPrimary,
      fontWeight: 'bold',
    },
    smallIcon: {
      fontSize: 20,
    },
    mediumIcon: {
      fontSize: 24,
    },
    largeIcon: {
      fontSize: 28,
    },
    title: {
      color: colors.onPrimary,
      fontWeight: '600',
      marginTop: spacing.xs,
    },
    smallTitle: {
      ...typography.small,
    },
    mediumTitle: {
      ...typography.caption,
    },
    largeTitle: {
      ...typography.body,
    },
  });
}
