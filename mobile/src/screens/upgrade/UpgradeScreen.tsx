/**
 * mobile/src/screens/upgrade/UpgradeScreen.tsx
 *
 * Production-ready subscription plan upgrade screen for SubTrackr mobile.
 */

import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { BillingCycleToggle } from './components/BillingCycleToggle';
import { FeatureDiffList } from './components/FeatureDiffList';
import { PlanCard } from './components/PlanCard';
import { ProrationSummary } from './components/ProrationSummary';
import { useUpgradeFlow } from './hooks';
import { formatMoney } from './selectors';
import type { PlanTier, UpgradeScreenProps } from './types';

export const UpgradeScreen: React.FC<UpgradeScreenProps> = ({
  currentTier = 'starter',
  currentBillingCycle = 'annual',
  daysRemainingInPeriod = 15,
  totalDaysInPeriod = 30,
  onCompleteUpgrade,
  onBack,
  metrics,
  testID = 'upgrade-screen',
}) => {
  const {
    selectedTier,
    billingCycle,
    step,
    error,
    prorationQuote,
    unlockedFeatures,
    plans,
    handleSelectTier,
    handleToggleCycle,
    handleProceed,
    handleBackToSelect,
  } = useUpgradeFlow({
    currentTier,
    initialBillingCycle: currentBillingCycle,
    daysRemaining: daysRemainingInPeriod,
    totalDays: totalDaysInPeriod,
    onCompleteUpgrade,
    metrics,
  });

  useEffect(() => {
    if (metrics?.onView) {
      metrics.onView(currentTier);
    }
  }, [currentTier, metrics]);

  // Success view
  if (step === 'success') {
    return (
      <View style={styles.centerContainer} testID="upgrade-success-view">
        <View style={styles.successBadge}>
          <Text style={styles.successCheck}>✓</Text>
        </View>
        <Text style={styles.title}>You are now on {plans[selectedTier].name}!</Text>
        <Text style={styles.subtitle}>
          Your new features and increased limits are active immediately.
        </Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Done, return to subscriptions"
          testID="upgrade-done-button">
          <Text style={styles.primaryButtonText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const targetPlan = plans[selectedTier];
  const isBusy = step === 'processing';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID={testID}
      keyboardShouldPersistTaps="handled">
      {/* Header */}
      <View style={styles.header}>
        {onBack && (
          <TouchableOpacity
            style={styles.backButton}
            onPress={step === 'confirm' ? handleBackToSelect : onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            testID="upgrade-back-button">
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.title}>Upgrade Your Plan</Text>
        <Text style={styles.subtitle}>
          Unlock automated renewal protection, higher limits, and multi-chain tracking.
        </Text>
      </View>

      {/* Error Alert Banner */}
      {error && (
        <View style={styles.errorBanner} testID="upgrade-error-banner">
          <Text style={styles.errorText} accessibilityRole="alert">
            {error}
          </Text>
        </View>
      )}

      {/* Cycle Segmented Control */}
      <BillingCycleToggle
        cycle={billingCycle}
        onToggle={handleToggleCycle}
        savingsPercent={prorationQuote.annualSavingsPercent}
      />

      {/* Tier Options */}
      <View style={styles.planList}>
        {(['starter', 'pro', 'enterprise'] as PlanTier[]).map((tier) => {
          const plan = plans[tier];
          return (
            <PlanCard
              key={tier}
              plan={plan}
              cycle={billingCycle}
              isSelected={selectedTier === tier}
              isCurrent={currentTier === tier}
              onSelect={() => handleSelectTier(tier)}
            />
          );
        })}
      </View>

      {/* Features Unlocked by Target Plan */}
      <FeatureDiffList
        unlockedFeatures={unlockedFeatures}
        targetTierName={targetPlan.name}
      />

      {/* Proration & Order Breakdown */}
      <ProrationSummary quote={prorationQuote} />

      {/* Action CTA */}
      <TouchableOpacity
        style={[styles.primaryButton, isBusy && styles.buttonDisabled]}
        onPress={handleProceed}
        disabled={isBusy}
        accessibilityRole="button"
        accessibilityLabel={`Upgrade to ${targetPlan.name} for ${formatMoney(prorationQuote.dueToday)}`}
        testID="upgrade-cta-button">
        {isBusy ? (
          <ActivityIndicator color="#0F172A" />
        ) : (
          <Text style={styles.primaryButtonText}>
            {step === 'confirm'
              ? `Confirm & Pay ${formatMoney(prorationQuote.dueToday)}`
              : `Continue with ${targetPlan.name}`}
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1120',
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#0B1120',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    marginBottom: 8,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    marginBottom: 8,
  },
  backText: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '600',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#94A3B8',
    lineHeight: 18,
  },
  planList: {
    marginVertical: 4,
  },
  errorBanner: {
    backgroundColor: '#7F1D1D',
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 13,
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: '#38BDF8',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '700',
  },
  successBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  successCheck: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
  },
});
