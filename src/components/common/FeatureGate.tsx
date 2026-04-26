import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useFeatureAccess, useFeatureLimits } from '../../hooks/useFeatureAccess';
import { FeatureId } from '../../types/feature';
import { colors, spacing, typography, borderRadius } from '../../utils/constants';

interface FeatureGateProps {
  feature: FeatureId;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  showUpgradePrompt?: boolean;
  upgradeMessage?: string;
}

/**
 * Component that conditionally renders children based on feature access
 */
export const FeatureGate: React.FC<FeatureGateProps> = ({
  feature,
  children,
  fallback,
  showUpgradePrompt = true,
  upgradeMessage,
}) => {
  const { hasAccess, reason, loading } = useFeatureAccess(feature);

  if (loading) {
    // Show loading state or nothing while checking access
    return null;
  }

  if (hasAccess) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  if (showUpgradePrompt) {
    return <UpgradePrompt feature={feature} reason={reason} message={upgradeMessage} />;
  }

  return null;
};

interface UpgradePromptProps {
  feature: FeatureId;
  reason?: string;
  message?: string;
}

const UpgradePrompt: React.FC<UpgradePromptProps> = ({ feature, reason, message }) => {
  const defaultMessage = reason
    ? `Upgrade to access ${feature.replace(/_/g, ' ')}`
    : 'Upgrade to unlock this feature';

  return (
    <View style={styles.upgradeContainer}>
      <Text style={styles.upgradeIcon}>🔒</Text>
      <Text style={styles.upgradeTitle}>Premium Feature</Text>
      <Text style={styles.upgradeMessage}>{message || defaultMessage}</Text>
      {reason && <Text style={styles.upgradeReason}>{reason}</Text>}
    </View>
  );
};

interface FeatureLimitGateProps {
  limitKey: string;
  currentUsage: number;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  showLimitMessage?: boolean;
}

/**
 * Component that conditionally renders based on feature limits
 */
export const FeatureLimitGate: React.FC<FeatureLimitGateProps> = ({
  limitKey,
  currentUsage,
  children,
  fallback,
  showLimitMessage = true,
}) => {
  const { hasExceededLimit, getRemainingUsage } = useFeatureLimits();
  const exceeded = hasExceededLimit(limitKey, currentUsage);
  const remaining = getRemainingUsage(limitKey, currentUsage);

  if (!exceeded) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  if (showLimitMessage) {
    return <LimitReachedMessage limitKey={limitKey} remaining={remaining} />;
  }

  return null;
};

interface LimitReachedMessageProps {
  limitKey: string;
  remaining: number;
}

const LimitReachedMessage: React.FC<LimitReachedMessageProps> = ({ limitKey, remaining }) => {
  const formatLimitKey = (key: string) => {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const getLimitMessage = () => {
    if (remaining === 0) {
      return `You've reached your ${formatLimitKey(limitKey)} limit`;
    } else if (remaining > 0) {
      return `${remaining} ${formatLimitKey(limitKey)} remaining`;
    } else {
      return `${formatLimitKey(limitKey)} limit reached`;
    }
  };

  return (
    <View style={styles.limitContainer}>
      <Text style={styles.limitIcon}>⚠️</Text>
      <Text style={styles.limitMessage}>{getLimitMessage()}</Text>
      <Text style={styles.limitSubtext}>Upgrade to increase your limits</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  upgradeContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    margin: spacing.md,
  },
  upgradeIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  upgradeTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  upgradeMessage: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  upgradeReason: {
    ...typography.caption,
    color: colors.primary,
    textAlign: 'center',
  },
  limitContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.warningBackground,
    borderRadius: borderRadius.lg,
    margin: spacing.md,
  },
  limitIcon: {
    fontSize: 32,
    marginBottom: spacing.sm,
  },
  limitMessage: {
    ...typography.body,
    color: colors.warning,
    textAlign: 'center',
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  limitSubtext: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
