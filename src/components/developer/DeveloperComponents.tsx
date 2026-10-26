import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Card } from '../common/Card';
import { colors, spacing, typography, borderRadius } from '../../utils/constants';
import { SandboxEnvironment } from '../../types/sandbox';

interface EnvironmentBadgeProps {
  environment: SandboxEnvironment;
  isActive?: boolean;
  onPress?: () => void;
}

export const EnvironmentBadge: React.FC<EnvironmentBadgeProps> = ({
  environment,
  isActive = false,
  onPress,
}) => {
  const envColors: Record<SandboxEnvironment, string> = {
    [SandboxEnvironment.DEVELOPMENT]: colors.primary,
    [SandboxEnvironment.STAGING]: colors.warning,
    [SandboxEnvironment.TESTING]: colors.accent,
    [SandboxEnvironment.PRODUCTION]: colors.success,
  };

  return (
    <TouchableOpacity
      style={[styles.badge, isActive && { backgroundColor: envColors[environment] }]}
      onPress={onPress}
      disabled={!onPress}>
      <Text style={[styles.badgeText, isActive && styles.badgeTextActive]}>
        {environment.toUpperCase()}
      </Text>
    </TouchableOpacity>
  );
};

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: string;
  trendDirection?: 'up' | 'down' | 'neutral';
}

export const StatCard: React.FC<StatCardProps> = ({ label, value, trend, trendDirection }) => {
  const trendColor =
    trendDirection === 'up'
      ? colors.success
      : trendDirection === 'down'
        ? colors.error
        : colors.textSecondary;

  return (
    <Card style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {trend && <Text style={[styles.statTrend, { color: trendColor }]}>{trend}</Text>}
    </Card>
  );
};

interface OnboardingStepProps {
  stepNumber: number;
  title: string;
  description: string;
  isCompleted: boolean;
  isCurrent: boolean;
  onPress?: () => void;
}

export const OnboardingStep: React.FC<OnboardingStepProps> = ({
  stepNumber,
  title,
  description,
  isCompleted,
  isCurrent,
  onPress,
}) => (
  <TouchableOpacity
    style={[styles.stepContainer, isCurrent && styles.stepCurrent]}
    onPress={onPress}
    disabled={!onPress}>
    <View style={[styles.stepNumber, isCompleted && styles.stepNumberCompleted]}>
      <Text style={[styles.stepNumberText, isCompleted && styles.stepNumberTextCompleted]}>
        {isCompleted ? '✓' : stepNumber}
      </Text>
    </View>
    <View style={styles.stepContent}>
      <Text style={[styles.stepTitle, isCompleted && styles.stepTitleCompleted]}>{title}</Text>
      <Text style={styles.stepDescription}>{description}</Text>
    </View>
  </TouchableOpacity>
);

interface QuickActionProps {
  icon: string;
  title: string;
  description: string;
  onPress: () => void;
}

export const QuickAction: React.FC<QuickActionProps> = ({ icon, title, description, onPress }) => (
  <TouchableOpacity style={styles.quickAction} onPress={onPress}>
    <Text style={styles.quickActionIcon}>{icon}</Text>
    <View style={styles.quickActionContent}>
      <Text style={styles.quickActionTitle}>{title}</Text>
      <Text style={styles.quickActionDescription}>{description}</Text>
    </View>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.round,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  badgeText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  badgeTextActive: {
    color: colors.text,
  },
  statCard: {
    flex: 1,
    minWidth: 140,
  },
  statValue: {
    ...typography.h2,
    color: colors.text,
    fontWeight: '800',
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  statTrend: {
    ...typography.caption,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  stepContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  stepCurrent: {
    backgroundColor: `${colors.primary}10`,
    marginHorizontal: -spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberCompleted: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  stepNumberText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  stepNumberTextCompleted: {
    color: colors.text,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  stepTitleCompleted: {
    color: colors.textSecondary,
    textDecorationLine: 'line-through',
  },
  stepDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  quickAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickActionIcon: {
    fontSize: 24,
  },
  quickActionContent: {
    flex: 1,
  },
  quickActionTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  quickActionDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
});
