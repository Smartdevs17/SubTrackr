/**
 * mobile/src/screens/upgrade/components/PlanCard.tsx
 *
 * Interactive plan card component with radio selection, price, and popular badges.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { formatMoney } from '../selectors';
import type { BillingCycle, UpgradePlan } from '../types';

export interface PlanCardProps {
  plan: UpgradePlan;
  cycle: BillingCycle;
  isSelected: boolean;
  isCurrent: boolean;
  onSelect: () => void;
  testID?: string;
}

export const PlanCard: React.FC<PlanCardProps> = ({
  plan,
  cycle,
  isSelected,
  isCurrent,
  onSelect,
  testID,
}) => {
  const displayPrice =
    cycle === 'annual' ? plan.annualMonthlyEquivalent : plan.monthlyPrice;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isSelected && styles.cardSelected,
        isCurrent && styles.cardCurrent,
      ]}
      onPress={onSelect}
      disabled={isCurrent}
      accessibilityRole="radio"
      accessibilityState={{ selected: isSelected, disabled: isCurrent }}
      accessibilityLabel={`${plan.name} plan, ${formatMoney(displayPrice)} per month, ${plan.tagline}`}
      testID={testID ?? `plan-card-${plan.tier}`}>
      {plan.badge && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{plan.badge}</Text>
        </View>
      )}

      <View style={styles.header}>
        <View style={styles.titleArea}>
          <Text style={styles.planName}>{plan.name}</Text>
          <Text style={styles.tagline}>{plan.tagline}</Text>
        </View>
        <View style={styles.radio}>
          <View
            style={[
              styles.radioOuter,
              isSelected && styles.radioOuterSelected,
              isCurrent && styles.radioOuterCurrent,
            ]}>
            {isSelected && <View style={styles.radioInner} />}
          </View>
        </View>
      </View>

      <View style={styles.priceRow}>
        <Text style={styles.priceAmount}>{formatMoney(displayPrice)}</Text>
        <Text style={styles.pricePeriod}>/ month</Text>
        {cycle === 'annual' && (
          <Text style={styles.billedAnnually}>
            (billed annually as {formatMoney(plan.annualMonthlyEquivalent * 12)})
          </Text>
        )}
      </View>

      {isCurrent && (
        <View style={styles.currentChip}>
          <Text style={styles.currentText}>Current Plan</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#334155',
  },
  cardSelected: {
    borderColor: '#38BDF8',
    backgroundColor: '#0F172A',
  },
  cardCurrent: {
    opacity: 0.65,
    borderColor: '#475569',
  },
  badge: {
    position: 'absolute',
    top: -10,
    right: 16,
    backgroundColor: '#38BDF8',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    color: '#0F172A',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  titleArea: {
    flex: 1,
  },
  planName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  tagline: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  radio: {
    marginLeft: 12,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#64748B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: '#38BDF8',
  },
  radioOuterCurrent: {
    borderColor: '#475569',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#38BDF8',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
  },
  priceAmount: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  pricePeriod: {
    fontSize: 13,
    color: '#94A3B8',
  },
  billedAnnually: {
    fontSize: 11,
    color: '#64748B',
    marginLeft: 4,
  },
  currentChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#334155',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 10,
  },
  currentText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#CBD5E1',
  },
});
