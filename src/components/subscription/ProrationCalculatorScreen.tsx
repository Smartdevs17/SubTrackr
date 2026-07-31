import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
} from 'react-native';
import { useProrationCalculator } from '../../hooks/useProrationCalculator';
import { BillingCycle } from '../../types/subscription';
import type { ProrationCalculationResult } from '../../types/prorationCalculator';

/**
 * Transparent Proration Calculator Screen Component
 *
 * Provides plan selection controls, transparent line-item breakdown display,
 * human-readable explanation card, and analytics summary.
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/784
 */
export const ProrationCalculatorScreen: React.FC = () => {
  const { calculate, activePreview, applyProration, analytics } = useProrationCalculator();

  const [currentPrice, setCurrentPrice] = useState('29.99');
  const [newPrice, setNewPrice] = useState('49.99');
  const [currentPlanName, setCurrentPlanName] = useState('Pro Monthly');
  const [newPlanName, setNewPlanName] = useState('Enterprise Monthly');
  const [daysRemaining, setDaysRemaining] = useState('15');
  const [cycleDays, setCycleDays] = useState('30');
  const [activeTab, setActiveTab] = useState<'calculator' | 'analytics'>('calculator');

  const handleCalculate = () => {
    const currP = parseFloat(currentPrice) || 0;
    const newP = parseFloat(newPrice) || 0;
    const remDays = parseInt(daysRemaining, 10) || 15;
    const totDays = parseInt(cycleDays, 10) || 30;

    const now = Date.now();
    const cycleStart = now - (totDays - remDays) * 86400000;
    const cycleEnd = now + remDays * 86400000;

    calculate({
      currentPlanId: 'plan-curr',
      currentPlanName,
      currentPrice: currP,
      currentCycle: BillingCycle.MONTHLY,
      newPlanId: 'plan-new',
      newPlanName,
      newPrice: newP,
      newCycle: BillingCycle.MONTHLY,
      cycleStartDate: cycleStart,
      cycleEndDate: cycleEnd,
      effectiveDate: now,
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <Text style={styles.headerTitle}>Proration Calculator</Text>
      <Text style={styles.headerSubtitle}>Transparent, exact-day plan change calculations</Text>

      {/* Tab Selector */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'calculator' && styles.tabButtonActive]}
          onPress={() => setActiveTab('calculator')}
        >
          <Text style={[styles.tabText, activeTab === 'calculator' && styles.tabTextActive]}>
            Calculator
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'analytics' && styles.tabButtonActive]}
          onPress={() => setActiveTab('analytics')}
        >
          <Text style={[styles.tabText, activeTab === 'analytics' && styles.tabTextActive]}>
            Analytics
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'calculator' ? (
        <>
          {/* Input Form */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Plan Change Configuration</Text>

            <View style={styles.row}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Current Plan Name</Text>
                <TextInput
                  style={styles.input}
                  value={currentPlanName}
                  onChangeText={setCurrentPlanName}
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Current Price ($)</Text>
                <TextInput
                  style={styles.input}
                  value={currentPrice}
                  keyboardType="numeric"
                  onChangeText={setCurrentPrice}
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>New Plan Name</Text>
                <TextInput
                  style={styles.input}
                  value={newPlanName}
                  onChangeText={setNewPlanName}
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>New Price ($)</Text>
                <TextInput
                  style={styles.input}
                  value={newPrice}
                  keyboardType="numeric"
                  onChangeText={setNewPrice}
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Days Remaining in Cycle</Text>
                <TextInput
                  style={styles.input}
                  value={daysRemaining}
                  keyboardType="numeric"
                  onChangeText={setDaysRemaining}
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Total Cycle Days</Text>
                <TextInput
                  style={styles.input}
                  value={cycleDays}
                  keyboardType="numeric"
                  onChangeText={setCycleDays}
                />
              </View>
            </View>

            <TouchableOpacity style={styles.primaryButton} onPress={handleCalculate}>
              <Text style={styles.primaryButtonText}>Calculate Proration</Text>
            </TouchableOpacity>
          </View>

          {/* Result Display */}
          {activePreview && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Transparent Proration Breakdown</Text>

              <View style={styles.summaryBadge}>
                <Text style={styles.summaryBadgeLabel}>Net Adjustment Due</Text>
                <Text style={styles.summaryBadgeAmount}>
                  {activePreview.isCredit ? '-' : ''}${activePreview.netProratedAmount.toFixed(2)}
                </Text>
              </View>

              {/* Explanation Box */}
              <View style={styles.explanationBox}>
                <Text style={styles.explanationTitle}>Explanation</Text>
                <Text style={styles.explanationText}>{activePreview.explanationText}</Text>
              </View>

              {/* Line Item Breakdown */}
              <Text style={styles.sectionSubtitle}>Detailed Calculation</Text>
              {activePreview.breakdown.map((item) => (
                <View key={item.id} style={styles.lineItem}>
                  <View style={styles.lineItemLeft}>
                    <Text style={styles.lineItemLabel}>{item.label}</Text>
                    <Text style={styles.lineItemDescription}>{item.description}</Text>
                  </View>
                  <Text style={[styles.lineItemAmount, item.isCredit && styles.creditText]}>
                    {item.isCredit ? '-' : '+'}${item.amount.toFixed(2)}
                  </Text>
                </View>
              ))}

              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => applyProration('sub-123', activePreview)}
              >
                <Text style={styles.secondaryButtonText}>Apply & Confirm Change</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      ) : (
        /* Analytics Tab */
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Proration Analytics</Text>

          <View style={styles.statsGrid}>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{analytics.totalCalculations}</Text>
              <Text style={styles.statLabel}>Total Calculations</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{analytics.totalUpgrades}</Text>
              <Text style={styles.statLabel}>Upgrades</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>${analytics.totalProratedRevenueCollected.toFixed(2)}</Text>
              <Text style={styles.statLabel}>Revenue Collected</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>${analytics.totalCreditsIssued.toFixed(2)}</Text>
              <Text style={styles.statLabel}>Credits Issued</Text>
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  contentContainer: {
    padding: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 16,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 8,
    padding: 4,
    marginBottom: 16,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  tabButtonActive: {
    backgroundColor: '#FFFFFF',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  tabTextActive: {
    color: '#2563EB',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1E293B',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  inputGroup: {
    flex: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    color: '#475569',
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#0F172A',
  },
  primaryButton: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  secondaryButtonText: {
    color: '#2563EB',
    fontSize: 14,
    fontWeight: '600',
  },
  summaryBadge: {
    backgroundColor: '#EFF6FF',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  summaryBadgeLabel: {
    fontSize: 12,
    color: '#1E40AF',
    fontWeight: '500',
  },
  summaryBadgeAmount: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1E3A8A',
  },
  explanationBox: {
    backgroundColor: '#F8FAFC',
    borderLeftWidth: 4,
    borderLeftColor: '#2563EB',
    padding: 12,
    borderRadius: 4,
    marginBottom: 16,
  },
  explanationTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563EB',
    marginBottom: 4,
  },
  explanationText: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 18,
  },
  sectionSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 8,
  },
  lineItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  lineItemLeft: {
    flex: 1,
    paddingRight: 8,
  },
  lineItemLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1E293B',
  },
  lineItemDescription: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  lineItemAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  creditText: {
    color: '#16A34A',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statBox: {
    width: '47%',
    backgroundColor: '#F8FAFC',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2563EB',
  },
  statLabel: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
  },
});
