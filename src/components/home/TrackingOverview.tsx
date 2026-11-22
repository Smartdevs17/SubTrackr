import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { spacing, typography, borderRadius } from '../../utils/constants';
import { formatCurrency, formatRelativeDate } from '../../utils/formatting';
import { buildTrackingSnapshot } from '../../utils/subscriptionTracking';
import type { Subscription } from '../../types/subscription';
import { useThemeColors } from '../../hooks/useThemeColors';

interface TrackingOverviewProps {
  subscriptions: Subscription[];
  currency?: string;
}

export const TrackingOverview: React.FC<TrackingOverviewProps> = ({
  subscriptions,
  currency = 'USD',
}) => {
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const snapshot = useMemo(() => buildTrackingSnapshot(subscriptions), [subscriptions]);

  if (!subscriptions.length) {
    return null;
  }

  const nextChargeLabel = snapshot.nextCharge
    ? `${snapshot.nextCharge.name} ${formatRelativeDate(new Date(snapshot.nextCharge.nextBillingDate))}`
    : 'None scheduled';

  return (
    <View
      style={styles.container}
      accessibilityRole="summary"
      accessibilityLabel={`Subscription tracking. ${snapshot.overdueCount} overdue, ${
        snapshot.dueThisWeekCount
      } due this week, next charge ${nextChargeLabel}.`}>
      <Text style={styles.title} accessibilityRole="header">
        Tracking
      </Text>
      <View style={styles.row}>
        <View
          style={[styles.chip, snapshot.overdueCount > 0 && styles.chipAlert]}
          accessible
          accessibilityLabel={`${snapshot.overdueCount} overdue subscriptions`}>
          <Text style={[styles.chipValue, snapshot.overdueCount > 0 && styles.chipAlertText]}>
            {snapshot.overdueCount}
          </Text>
          <Text style={styles.chipLabel}>Overdue</Text>
        </View>
        <View
          style={styles.chip}
          accessible
          accessibilityLabel={`${snapshot.dueThisWeekCount} subscriptions due this week`}>
          <Text style={styles.chipValue}>{snapshot.dueThisWeekCount}</Text>
          <Text style={styles.chipLabel}>Due this week</Text>
        </View>
        <View
          style={styles.chip}
          accessible
          accessibilityLabel={`Due this month ${formatCurrency(snapshot.dueThisMonthSpend, currency)}`}>
          <Text style={styles.chipValue} numberOfLines={1}>
            {formatCurrency(snapshot.dueThisMonthSpend, currency)}
          </Text>
          <Text style={styles.chipLabel}>Due in 30 days</Text>
        </View>
      </View>
      <Text style={styles.nextCharge} accessibilityLabel={`Next charge, ${nextChargeLabel}`}>
        Next: {nextChargeLabel}
      </Text>
    </View>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.md,
      padding: spacing.md,
      backgroundColor: colors.background.card,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    title: {
      ...typography.h3,
      color: colors.text.primary,
      marginBottom: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    chip: {
      flex: 1,
      minHeight: 44,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.xs,
      borderRadius: borderRadius.sm,
      backgroundColor: colors.background.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipAlert: {
      borderWidth: 1,
      borderColor: colors.error,
    },
    chipValue: {
      ...typography.h3,
      color: colors.text.primary,
    },
    chipAlertText: {
      color: colors.error,
    },
    chipLabel: {
      ...typography.caption,
      color: colors.text.secondary,
      textAlign: 'center',
    },
    nextCharge: {
      ...typography.caption,
      color: colors.text.secondary,
      marginTop: spacing.sm,
    },
  });
}
