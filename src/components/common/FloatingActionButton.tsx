import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, spacing, typography, borderRadius, shadows } from '../../utils/constants';

export interface FloatingActionButtonProps {
  onPress: () => void;
  icon?: string;
  title?: string;
  style?: ViewStyle;
  size?: 'small' | 'medium' | 'large';
}

export const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({
  onPress,
  icon = '+',
  title,
  style,
  size = 'medium',
}) => {
  const buttonStyle = [
    styles.button,
    styles[size],
    style,
  ];

  return (
    <TouchableOpacity
      style={buttonStyle}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={[styles.icon, styles[`${size}Icon`]]}>
        {icon}
      </Text>
      {title && (
        <Text style={[styles.title, styles[`${size}Title`]]}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.lg,
  },
  
  // Sizes
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
  
  // Icon styles
  icon: {
    color: colors.text,
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
  
  // Title styles
  title: {
    color: colors.text,
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
