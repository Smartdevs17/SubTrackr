import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SubscriptionPlan, BillingCycle } from '../../types/subscription';
import { colors, spacing, typography } from '../../utils/constants';

interface AnnualSavingsBadgeProps {
  monthlyPlan: SubscriptionPlan;
  annualPlan?: SubscriptionPlan;
}

export const AnnualSavingsBadge: React.FC<AnnualSavingsBadgeProps> = ({
  monthlyPlan,
  annualPlan,
}) => {
  const isMonthlyBilling = monthlyPlan.billingCycle === BillingCycle.MONTHLY;

  if (!isMonthlyBilling || !annualPlan) {
    return null;
  }

  const monthlyYearlyTotal = monthlyPlan.price * 12;
  const annualYearlyTotal = annualPlan.price;
  const savingsAmount = monthlyYearlyTotal - annualYearlyTotal;
  const savingsPercentage = (savingsAmount / monthlyYearlyTotal) * 100;

  if (savingsPercentage <= 0) {
    return null;
  }

  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>Save {Math.round(savingsPercentage)}%</Text>
      <Text style={styles.savingsAmount}>${savingsAmount.toFixed(2)}/year</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    backgroundColor: colors.success,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    alignItems: 'center',
    marginVertical: spacing.sm,
  },
  badgeText: {
    ...typography.button,
    color: colors.surface,
    fontWeight: '700',
    fontSize: 13,
  },
  savingsAmount: {
    ...typography.caption,
    color: colors.surface,
    fontSize: 11,
    marginTop: 2,
  },
});
