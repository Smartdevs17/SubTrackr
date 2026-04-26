import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, SafeAreaView } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { colors, spacing, typography, borderRadius, shadows } from '../utils/constants';
import { useUsageStore } from '../store/usageStore';
import { QuotaMetric, QuotaStatus } from '../types/usage';
import { Button } from '../components/common/Button';
import { Ionicons } from '@expo/vector-icons';

const UsageDashboard: React.FC = () => {
  const route = useRoute<any>();
  const navigation = useNavigation();
  const { subscriptionId, planId, name } = route.params || {};
  const { records, fetchUsage, isLoading } = useUsageStore();

  const subscriptionRecords = records[subscriptionId] || [];

  useEffect(() => {
    if (subscriptionId && planId) {
      fetchUsage(subscriptionId, planId);
    }
  }, [subscriptionId, planId]);

  const getStatusColor = (status: QuotaStatus) => {
    switch (status) {
      case QuotaStatus.HARD_LIMIT_REACHED: return colors.error;
      case QuotaStatus.SOFT_LIMIT_REACHED: return colors.warning;
      default: return colors.success;
    }
  };

  const renderUsageCard = (metric: string, current: number, limit: number, unit: string) => {
    const progress = Math.min(current / limit, 1);
    const percentage = Math.round(progress * 100);
    const isError = percentage >= 100;
    const isWarning = percentage >= 80;

    return (
      <View style={styles.card} key={metric}>
        <View style={styles.cardHeader}>
          <Text style={styles.metricTitle}>{metric}</Text>
          <Text style={[styles.percentageText, { color: isError ? colors.error : isWarning ? colors.warning : colors.success }]}>
            {percentage}%
          </Text>
        </View>
        
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { width: `${percentage}%`, backgroundColor: isError ? colors.error : isWarning ? colors.warning : colors.primary }]} />
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

        {renderUsageCard('API Calls', 850, 1000, 'requests')}
        {renderUsageCard('Storage', 45, 50, 'GB')}
        {renderUsageCard('Seats', 8, 10, 'users')}

        <View style={styles.notificationCard}>
          <Ionicons name="notifications-outline" size={24} color={colors.primary} />
          <View style={styles.notificationTextContainer}>
            <Text style={styles.notificationTitle}>Quota Alert</Text>
            <Text style={styles.notificationBody}>Your API Call usage is at 85%. You might want to upgrade your plan soon to avoid service interruption.</Text>
          </View>
        </View>

        <Button 
          title="Upgrade Plan" 
          onPress={() => {}} 
          style={styles.upgradeButton}
        />
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
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.bold,
    color: colors.text,
  },
  scrollContent: {
    padding: spacing.md,
  },
  subInfo: {
    marginBottom: spacing.lg,
  },
  subName: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.text,
  },
  subId: {
    fontSize: typography.sizes.sm,
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
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.text,
  },
  percentageText: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.bold,
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
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
  },
  remainingText: {
    fontSize: typography.sizes.sm,
    color: colors.primary,
    fontWeight: typography.weights.medium,
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
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.bold,
    color: colors.primary,
  },
  notificationBody: {
    fontSize: typography.sizes.sm,
    color: colors.text,
    marginTop: spacing.xs,
  },
  upgradeButton: {
    marginTop: spacing.xl,
  },
});

export default UsageDashboard;
