import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SubscriptionPlan, SubscriptionTier } from '../../types/subscription';
import { colors, spacing, typography } from '../../utils/constants';

interface PlanComparisonHeatmapProps {
  plans: SubscriptionPlan[];
}

export const PlanComparisonHeatmap: React.FC<PlanComparisonHeatmapProps> = ({ plans }) => {
  const getFeatureCoverage = (plan: SubscriptionPlan): number => {
    return ((plan.features?.length || 0) / Math.max(...plans.map(p => p.features?.length || 0))) * 100;
  };

  const getHeatColor = (coverage: number): string => {
    if (coverage === 0) return colors.error;
    if (coverage < 30) return '#FF9999';
    if (coverage < 60) return '#FFD699';
    if (coverage < 85) return '#B3D9B3';
    return colors.success;
  };

  const tierOrder: SubscriptionTier[] = [
    SubscriptionTier.FREE,
    SubscriptionTier.BASIC,
    SubscriptionTier.PREMIUM,
    SubscriptionTier.ENTERPRISE,
  ];

  const sortedPlans = plans.sort(
    (a, b) => tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier)
  );

  return (
    <ScrollView style={styles.container} horizontal>
      <View style={styles.heatmapContainer}>
        <Text style={styles.title}>Feature Coverage Comparison</Text>
        <View style={styles.heatmap}>
          {sortedPlans.map((plan) => {
            const coverage = getFeatureCoverage(plan);
            return (
              <View key={plan.id} style={styles.planColumn}>
                <Text style={styles.planName}>{plan.name}</Text>
                <View
                  style={[
                    styles.heatCell,
                    { backgroundColor: getHeatColor(coverage) },
                  ]}>
                  <Text style={styles.cellText}>{Math.round(coverage)}%</Text>
                </View>
                <Text style={styles.featuresCount}>{plan.features?.length || 0} features</Text>
                <Text style={styles.price}>${plan.price}</Text>
              </View>
            );
          })}
        </View>
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.error }]} />
            <Text style={styles.legendText}>0-29%</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#FFD699' }]} />
            <Text style={styles.legendText}>30-59%</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#B3D9B3' }]} />
            <Text style={styles.legendText}>60-84%</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
            <Text style={styles.legendText}>85-100%</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
  },
  heatmapContainer: {
    padding: spacing.lg,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  heatmap: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  planColumn: {
    alignItems: 'center',
  },
  planName: {
    ...typography.body,
    color: colors.text,
    marginBottom: spacing.sm,
    fontWeight: '600',
  },
  heatCell: {
    width: 100,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    marginBottom: spacing.sm,
  },
  cellText: {
    ...typography.h3,
    color: colors.surface,
    fontWeight: 'bold',
  },
  featuresCount: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  price: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
