/**
 * Issue #776 – Side-by-side plan comparison with recommendation CTA.
 */

import React, { useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { usePlanComparisonStore } from '../store/planComparisonStore';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { useThemeColors } from '../hooks/useThemeColors';
import { spacing, typography, borderRadius } from '../utils/constants';
import { formatCurrency } from '../utils/formatting';
import type { ComparablePlan } from '../types/planComparison';

type Props = NativeStackScreenProps<RootStackParamList, 'PlanComparison'>;

const DEMO_PLANS: ComparablePlan[] = [
  {
    id: 'basic',
    name: 'Basic',
    price: 9.99,
    currency: 'USD',
    billingCycle: 'monthly',
    tierRank: 1,
    features: [
      { id: 'users', name: 'Users', category: 'limits', value: 3 },
      { id: 'storage', name: 'Storage GB', category: 'limits', value: 10 },
      { id: 'api', name: 'API Access', category: 'integrations', value: false },
      { id: 'support', name: 'Priority Support', category: 'support', value: false },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 29.99,
    currency: 'USD',
    billingCycle: 'monthly',
    tierRank: 2,
    popular: true,
    features: [
      { id: 'users', name: 'Users', category: 'limits', value: 25 },
      { id: 'storage', name: 'Storage GB', category: 'limits', value: 100 },
      { id: 'api', name: 'API Access', category: 'integrations', value: true },
      { id: 'support', name: 'Priority Support', category: 'support', value: true },
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 99.99,
    currency: 'USD',
    billingCycle: 'monthly',
    tierRank: 4,
    features: [
      { id: 'users', name: 'Users', category: 'limits', value: 500 },
      { id: 'storage', name: 'Storage GB', category: 'limits', value: 1000 },
      { id: 'api', name: 'API Access', category: 'integrations', value: true },
      { id: 'support', name: 'Priority Support', category: 'support', value: true },
    ],
  },
];

const PlanComparisonScreen: React.FC<Props> = () => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const {
    selectedPlans,
    comparison,
    recommendations,
    lastShare,
    error,
    setSelectedPlans,
    runComparison,
    runRecommendation,
    shareComparison,
    trackEvent,
  } = usePlanComparisonStore();

  const plans = selectedPlans.length >= 2 ? selectedPlans : DEMO_PLANS;

  const handleCompare = useCallback(() => {
    setSelectedPlans(plans);
    const result = runComparison();
    if (result) {
      runRecommendation({
        budget: 50,
        requiredFeatures: ['api'],
        usageLevel: 'moderate',
        prioritizeValue: true,
      });
    }
  }, [plans, setSelectedPlans, runComparison, runRecommendation]);

  const topRec = recommendations[0];

  const handleAcceptRecommendation = useCallback(() => {
    if (!topRec) return;
    trackEvent({
      recommendationId: comparison?.id ?? 'rec',
      planId: topRec.planId,
      eventType: 'accept',
      comparisonId: comparison?.id,
    });
    Alert.alert('Plan selected', `${topRec.planName} marked as accepted.`);
  }, [topRec, comparison, trackEvent]);

  const handleShare = useCallback(() => {
    if (!comparison) {
      Alert.alert('Compare first', 'Run a comparison before sharing.');
      return;
    }
    const share = shareComparison(7 * 24 * 60 * 60 * 1000);
    if (share) {
      Alert.alert('Share link', `Token: ${share.token}`);
    }
  }, [comparison, shareComparison]);

  const featureIds = useMemo(() => {
    const ids = new Map<string, string>();
    for (const plan of plans) {
      for (const f of plan.features) {
        if (!ids.has(f.id)) ids.set(f.id, f.name);
      }
    }
    return [...ids.entries()];
  }, [plans]);

  const formatFeatureValue = (value: boolean | string | number | null | undefined) => {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Plan Comparison</Text>
        <Text style={styles.subtitle}>
          Compare features and pricing side-by-side, then get a recommendation.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.matrix}>
            <View style={styles.row}>
              <View style={styles.labelCell}>
                <Text style={styles.labelText}>Plan</Text>
              </View>
              {plans.map((plan) => (
                <View key={plan.id} style={styles.planCell}>
                  <Text style={styles.planName}>{plan.name}</Text>
                  <Text style={styles.planPrice}>
                    {formatCurrency(plan.price, plan.currency)}
                    <Text style={styles.cycle}>
                      /{plan.billingCycle === 'yearly' ? 'yr' : 'mo'}
                    </Text>
                  </Text>
                </View>
              ))}
            </View>

            {featureIds.map(([id, name]) => (
              <View key={id} style={styles.row}>
                <View style={styles.labelCell}>
                  <Text style={styles.labelText}>{name}</Text>
                </View>
                {plans.map((plan) => {
                  const feature = plan.features.find((f) => f.id === id);
                  const winner =
                    comparison?.featureMatrix.find((d) => d.featureId === id)?.winnerPlanId ===
                    plan.id;
                  return (
                    <View key={`${plan.id}-${id}`} style={styles.planCell}>
                      <Text style={[styles.featureValue, winner && styles.winner]}>
                        {formatFeatureValue(feature?.value)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>

        <View style={styles.actions}>
          <Button title="Compare & Recommend" onPress={handleCompare} />
          <Button title="Share Comparison" onPress={handleShare} variant="outline" />
        </View>

        {comparison ? (
          <Card style={styles.resultCard}>
            <Text style={styles.sectionTitle}>Winners</Text>
            <Text style={styles.meta}>
              Cheapest: {plans.find((p) => p.id === comparison.winners.cheapest)?.name}
            </Text>
            <Text style={styles.meta}>
              Most features: {plans.find((p) => p.id === comparison.winners.mostFeatures)?.name}
            </Text>
            <Text style={styles.meta}>
              Best value: {plans.find((p) => p.id === comparison.winners.bestValue)?.name}
            </Text>
            {lastShare ? (
              <Text style={styles.shareToken}>Share token: {lastShare.token}</Text>
            ) : null}
          </Card>
        ) : null}

        {topRec ? (
          <Card style={styles.recCard}>
            <Text style={styles.sectionTitle}>Recommended</Text>
            <Text style={styles.recName}>{topRec.planName}</Text>
            <Text style={styles.meta}>
              Score {topRec.score.total.toFixed(2)} · ~
              {formatCurrency(topRec.estimatedMonthlyCost, 'USD')}/mo
            </Text>
            {topRec.reasons.map((reason) => (
              <Text key={reason} style={styles.reason}>
                • {reason}
              </Text>
            ))}
            <Button title="Choose recommended plan" onPress={handleAcceptRecommendation} />
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background.primary,
    },
    content: {
      padding: spacing.md,
      paddingBottom: spacing.xl,
    },
    title: {
      ...typography.h2,
      color: colors.text.primary,
      marginBottom: spacing.xs,
    },
    subtitle: {
      ...typography.body,
      color: colors.text.secondary,
      marginBottom: spacing.md,
    },
    error: {
      ...typography.caption,
      color: colors.status.error,
      marginBottom: spacing.sm,
    },
    matrix: {
      minWidth: '100%',
      marginBottom: spacing.md,
    },
    row: {
      flexDirection: 'row',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border.default,
    },
    labelCell: {
      width: 110,
      paddingVertical: spacing.sm,
      paddingRight: spacing.sm,
      justifyContent: 'center',
    },
    planCell: {
      width: 120,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.xs,
      alignItems: 'center',
    },
    labelText: {
      ...typography.caption,
      color: colors.text.secondary,
    },
    planName: {
      ...typography.body,
      fontWeight: '600',
      color: colors.text.primary,
    },
    planPrice: {
      ...typography.body,
      color: colors.text.primary,
      marginTop: 2,
    },
    cycle: {
      ...typography.caption,
      color: colors.text.secondary,
    },
    featureValue: {
      ...typography.body,
      color: colors.text.primary,
    },
    winner: {
      color: colors.status.success,
      fontWeight: '600',
    },
    actions: {
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    resultCard: {
      marginBottom: spacing.md,
      padding: spacing.md,
      borderRadius: borderRadius.md,
    },
    recCard: {
      padding: spacing.md,
      borderRadius: borderRadius.md,
      gap: spacing.xs,
    },
    sectionTitle: {
      ...typography.h3,
      color: colors.text.primary,
      marginBottom: spacing.xs,
    },
    meta: {
      ...typography.body,
      color: colors.text.secondary,
      marginBottom: 2,
    },
    shareToken: {
      ...typography.caption,
      color: colors.text.secondary,
      marginTop: spacing.sm,
    },
    recName: {
      ...typography.body,
      fontWeight: '700',
      color: colors.text.primary,
      fontSize: 18,
    },
    reason: {
      ...typography.caption,
      color: colors.text.secondary,
      marginBottom: 2,
    },
  });
}

export default PlanComparisonScreen;
