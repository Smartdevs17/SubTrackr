/**
 * mobile/src/screens/upgrade/components/ProrationSummary.tsx
 *
 * Transparent breakdown of credits, amounts due today, and future billing dates.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatMoney } from '../selectors';
import type { ProrationQuote } from '../types';

export interface ProrationSummaryProps {
  quote: ProrationQuote;
  testID?: string;
}

export const ProrationSummary: React.FC<ProrationSummaryProps> = ({
  quote,
  testID = 'proration-summary',
}) => {
  return (
    <View style={styles.container} testID={testID}>
      <Text style={styles.title}>Order Summary</Text>

      <View style={styles.row}>
        <Text style={styles.label}>Target Plan ({quote.billingCycle})</Text>
        <Text style={styles.value}>{formatMoney(quote.grossTargetPrice)}</Text>
      </View>

      {quote.unusedCredit > 0 && (
        <View style={styles.row}>
          <Text style={styles.creditLabel}>
            Credit for unused days ({quote.daysRemaining} days left)
          </Text>
          <Text style={styles.creditValue}>-{formatMoney(quote.unusedCredit)}</Text>
        </View>
      )}

      <View style={styles.divider} />

      <View style={styles.row}>
        <Text style={styles.totalLabel}>Amount Due Today</Text>
        <Text style={styles.totalValue}>{formatMoney(quote.dueToday)}</Text>
      </View>

      <Text style={styles.renewalNotice}>
        Renews automatically on {quote.nextBillingDate} at standard {quote.billingCycle} rate.
        Cancel or change plans at any time in Billing Settings.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 16,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: '#CBD5E1',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 4,
  },
  label: {
    fontSize: 13,
    color: '#94A3B8',
  },
  value: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F8FAFC',
  },
  creditLabel: {
    fontSize: 13,
    color: '#34D399',
  },
  creditValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#34D399',
  },
  divider: {
    height: 1,
    backgroundColor: '#1E293B',
    marginVertical: 8,
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#38BDF8',
  },
  renewalNotice: {
    fontSize: 11,
    color: '#64748B',
    lineHeight: 16,
    marginTop: 8,
  },
});
