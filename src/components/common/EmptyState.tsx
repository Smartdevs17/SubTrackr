import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { spacing, typography, borderRadius } from '../../utils/constants';
import { useThemeColors } from '../../hooks/useThemeColors';

interface EmptyStateProps {
  icon: string;
  title: string;
  message: string;
  actionText?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  message,
  actionText,
  onAction,
}) => {
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  return (
    <View
      style={styles.container}
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel={`${title}. ${message}`}>
      <Text style={styles.icon} accessibilityElementsHidden={true} importantForAccessibility="no">
        {icon}
      </Text>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.message}>{message}</Text>
      {actionText && onAction && (
        <TouchableOpacity
          style={styles.button}
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionText}
          accessibilityHint="Activates the suggested action">
          <Text style={styles.buttonText}>{actionText}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.xl * 2,
      paddingHorizontal: spacing.lg,
    },
    icon: {
      fontSize: 56,
      marginBottom: spacing.md,
    },
    title: {
      ...typography.h3,
      color: colors.text.primary,
      marginBottom: spacing.sm,
      textAlign: 'center',
      fontWeight: '600',
    },
    message: {
      ...typography.body,
      color: colors.text.secondary,
      textAlign: 'center',
      lineHeight: 24,
      marginBottom: spacing.lg,
    },
    button: {
      backgroundColor: colors.brand.primary,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      borderRadius: borderRadius.md,
      marginTop: spacing.md,
    },
    buttonText: {
      ...typography.body,
      color: colors.onPrimary,
      fontWeight: '600',
      fontSize: 16,
    },
  });
}
