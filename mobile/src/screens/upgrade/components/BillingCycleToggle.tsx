/**
 * mobile/src/screens/upgrade/components/BillingCycleToggle.tsx
 *
 * Accessible segmented control between Monthly and Annual billing with savings chip.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { BillingCycle } from '../types';

export interface BillingCycleToggleProps {
  cycle: BillingCycle;
  onToggle: (cycle: BillingCycle) => void;
  savingsPercent?: number;
  testID?: string;
}

export const BillingCycleToggle: React.FC<BillingCycleToggleProps> = ({
  cycle,
  onToggle,
  savingsPercent = 20,
  testID = 'billing-cycle-toggle',
}) => {
  return (
    <View style={styles.container} testID={testID}>
      <TouchableOpacity
        style={[styles.segment, cycle === 'monthly' && styles.segmentActive]}
        onPress={() => onToggle('monthly')}
        accessibilityRole="tab"
        accessibilityState={{ selected: cycle === 'monthly' }}
        accessibilityLabel="Monthly billing"
        testID="toggle-monthly">
        <Text style={[styles.label, cycle === 'monthly' && styles.labelActive]}>
          Monthly
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.segment, cycle === 'annual' && styles.segmentActive]}
        onPress={() => onToggle('annual')}
        accessibilityRole="tab"
        accessibilityState={{ selected: cycle === 'annual' }}
        accessibilityLabel={`Annual billing, save ${savingsPercent}%`}
        testID="toggle-annual">
        <View style={styles.annualRow}>
          <Text style={[styles.label, cycle === 'annual' && styles.labelActive]}>
            Annual
          </Text>
          <View style={styles.savingsBadge}>
            <Text style={styles.savingsText}>Save {savingsPercent}%</Text>
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 4,
    marginVertical: 12,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  segmentActive: {
    backgroundColor: '#0F172A',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
  },
  labelActive: {
    color: '#F8FAFC',
  },
  annualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  savingsBadge: {
    backgroundColor: '#059669',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  savingsText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
});
