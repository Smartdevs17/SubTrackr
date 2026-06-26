import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, SafeAreaView } from 'react-native';
import { useAppRoute, useAppNavigation } from '../navigation/types';
import { colors, spacing, typography, borderRadius, shadows } from '../utils/constants';
import { useUsageStore } from '../store/usageStore';
import { QuotaMetric, QuotaStatus } from '../types/usage';
import { Button } from '../components/common/Button';
import { Ionicons } from '@expo/vector-icons';

const METRIC_LABELS: Record<QuotaMetric, { label: string; unit: string }> = {
  [QuotaMetric.API_CALLS]: { label: 'API Calls', unit: 'requests' },
  [QuotaMetric.STORAGE]: { label: 'Storage', unit: 'GB' },
  [QuotaMetric.SEATS]: { label: 'Seats', unit: 'users' },
};

const UsageDashboard: React.FC = () => {
  const route = useAppRoute<'UsageDashboard'>();
  const navigation = useAppNavigation<'UsageDashboard'>();
  const { subscriptionId, planId = 'free', name } = route.params ?? {};
  const { fetchUsage, getCurrentPeriodConsumption } = useUsageStore();

  useEffect(() => {
    if (subscriptionId && planId) {
      fetchUsage(subscriptionId, planId);
    }
  }, [subscriptionId, planId, fetchUsage]);

  const consumption = useMemo(
    () => (subscriptionId ? getCurrentPeriodConsumption(subscriptionId, planId) : []),
    [subscriptionId, planId, getCurrentPeriodConsumption]
  );

  const softAlerts = consumption.filter((c) => c.status === QuotaStatus.SOFT_LIMIT_REACHED);
  const hardAlerts = consumption.filter((c) => c.status === QuotaStatus.HARD_LIMIT_REACHED);

  const renderUsageCard = (
    metric: QuotaMetric,
    current: number,
    limit: number,
    percentage: number
  ) => {
    const { label, unit } = METRIC_LABELS[metric] ?? { label: metric, unit: '' };
    const isError = percentage >= 100;
    const isWarning = percentage >= 80;

    return (
      <View style={styles.card} key={metric}>
        <View style={styles.cardHeader}>
          <Text style={styles.metricTitle}>{label}</Text>
          <Text
            style={[
              styles.percentageText,
              { color: isError ? colors.error : isWarning ? colors.warning : colors.success },
            ]}>
            {percentage}%
          </Text>
        </View>

        <View style={styles.progressContainer}>
          <View
            style={[
              styles.progressBar,
              {
                width: `${percentage}%`,
                backgroundColor: isError
                  ? colors.error
                  : isWarning
                    ? colors.warning
                    : colors.primary,
              },
            ]}
          />
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.usageText}>
            {current.toLocaleString()} / {limit.toLocaleString()} {unit}
          </Text>
          <Text style={styles.remainingText}>
            {Math.max(0, limit - current).toLocaleString()} {unit} left
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Usage Dashboard</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.subInfo}>
          <Text style={styles.subName}>{name || 'Subscription Usage'}</Text>
          <Text style={styles.subId}>ID: {subscriptionId}</Text>
        </View>

        {consumption.map((c) => renderUsageCard(c.metric, c.current, c.limit, c.percentage))}

        {hardAlerts.length > 0 && (
          <View style={[styles.notificationCard, { backgroundColor: colors.error + '10' }]}>
            <Ionicons name="alert-circle-outline" size={24} color={colors.error} />
            <View style={styles.notificationTextContainer}>
              <Text style={[styles.notificationTitle, { color: colors.error }]}>
                Hard Limit Reached
              </Text>
              <Text style={styles.notificationBody}>
                Your {METRIC_LABELS[hardAlerts[0].metric]?.label ?? hardAlerts[0].metric} usage has
                hit its limit. New usage is blocked until you upgrade or the period resets.
              </Text>
            </View>
          </View>
        )}

        {hardAlerts.length === 0 && softAlerts.length > 0 && (
          <View style={styles.notificationCard}>
            <Ionicons name="notifications-outline" size={24} color={colors.primary} />
            <View style={styles.notificationTextContainer}>
              <Text style={styles.notificationTitle}>Quota Alert</Text>
              <Text style={styles.notificationBody}>
                Your {METRIC_LABELS[softAlerts[0].metric]?.label ?? softAlerts[0].metric} usage is
                at {softAlerts[0].percentage}%. You might want to upgrade your plan soon to avoid
                service interruption.
              </Text>
            </View>
          </View>
        )}

        <Button title="Upgrade Plan" onPress={() => {}} style={styles.upgradeButton} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    marginRight: spacing.md,
  },
  title: {
    ...typography.h3,
    color: colors.text,
  },
  scrollContent: {
    padding: spacing.md,
  },
  subInfo: {
    marginBottom: spacing.lg,
  },
  subName: {
    ...typography.h2,
    color: colors.text,
  },
  subId: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  metricTitle: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  percentageText: {
    ...typography.h3,
  },
  progressContainer: {
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  progressBar: {
    height: '100%',
    borderRadius: 4,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  usageText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  remainingText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '500',
  },
  notificationCard: {
    flexDirection: 'row',
    backgroundColor: colors.primary + '10',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginTop: spacing.md,
    alignItems: 'center',
  },
  notificationTextContainer: {
    marginLeft: spacing.md,
    flex: 1,
  },
  notificationTitle: {
    ...typography.body,
    fontWeight: '600',
    color: colors.primary,
  },
  notificationBody: {
    ...typography.caption,
    color: colors.text,
    marginTop: spacing.xs,
  },
  upgradeButton: {
    marginTop: spacing.xl,
  },
});

export default UsageDashboard;
