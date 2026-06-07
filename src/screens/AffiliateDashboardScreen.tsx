import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useAffiliateStore } from '../store/affiliateStore';
import { useWalletStore, selectAddress } from '../store/walletStore';
import { Card } from '../components/common/Card';
import { AffiliateStatus } from '../types/affiliate';

const AffiliateDashboardScreen: React.FC = () => {
  const {
    affiliates,
    programs,
    commissions,
    metrics,
    registerAffiliate,
    trackClick,
    trackReferral,
    payoutCommission,
    updateAffiliateStatus,
    triggerClawback,
    getMetrics,
  } = useAffiliateStore();
  const address = useWalletStore(selectAddress);

  const [programModalVisible, setProgramModalVisible] = useState(false);
  const [selectedProgram, setSelectedProgram] = useState<string>('');
  const [selectedAttributionModel, setSelectedAttributionModel] = useState<
    'first-touch' | 'last-touch' | 'linear'
  >('last-touch');
  const [customCookieWindow, setCustomCookieWindow] = useState('30');

  // Simulation Inputs
  const [simSubscriptionId, setSimSubscriptionId] = useState('sub_premium_99');
  const [simAmount, setSimAmount] = useState('49.99');
  const [simIp, setSimIp] = useState('192.168.1.105');
  const [simUserAgent, setSimUserAgent] = useState('Mozilla/5.0 Chrome/120.0.0');

  useEffect(() => {
    const currentMetrics = getMetrics();
    useAffiliateStore.setState({ metrics: currentMetrics });
  }, [affiliates, commissions, getMetrics]);

  const handleRegister = useCallback(async () => {
    // Fallback/Mock address if no wallet is connected
    const activeAddress = address || '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';

    if (!selectedProgram) {
      Alert.alert('Error', 'Please select a program');
      return;
    }

    await registerAffiliate(activeAddress, selectedProgram);

    // Sync newly chosen program parameters to default programs
    const updatedPrograms = programs.map((p) =>
      p.id === selectedProgram
        ? {
            ...p,
            attributionWindowDays: parseInt(customCookieWindow, 10) || 30,
            attributionModel: selectedAttributionModel,
          }
        : p
    );
    useAffiliateStore.setState({ programs: updatedPrograms });

    setProgramModalVisible(false);
    Alert.alert('Success', 'Registered as an affiliate successfully!');
  }, [
    address,
    selectedProgram,
    registerAffiliate,
    customCookieWindow,
    selectedAttributionModel,
    programs,
  ]);

  const handlePayout = useCallback(
    async (affiliateId: string) => {
      const affiliate = affiliates.find((a) => a.id === affiliateId);
      if (!affiliate) return;

      if (affiliate.pendingPayout < affiliate.paymentThreshold) {
        Alert.alert(
          'Payout Threshold',
          `Required: $${affiliate.paymentThreshold.toFixed(2)}. Current pending balance: $${affiliate.pendingPayout.toFixed(2)}`
        );
        return;
      }

      try {
        await payoutCommission(affiliateId);
        Alert.alert('Success', 'Your payout request was processed instantly!');
      } catch (err) {
        Alert.alert('Error', err instanceof Error ? err.message : 'Payout failed');
      }
    },
    [affiliates, payoutCommission]
  );

  const handleCopyLink = useCallback((link: string) => {
    Alert.alert('Copied to Clipboard!', link);
  }, []);

  const handleSimulationClick = useCallback(
    async (referralCode: string) => {
      try {
        await trackClick(referralCode, simIp, simUserAgent);
        Alert.alert('Success', `Simulated referral link click! Click logged for ${referralCode}`);
      } catch (err) {
        Alert.alert('Blocked', err instanceof Error ? err.message : 'Click limit reached');
      }
    },
    [trackClick, simIp, simUserAgent]
  );

  const handleSimulationConversion = useCallback(
    async (affiliateId: string) => {
      try {
        const amt = parseFloat(simAmount) || 29.99;
        await trackReferral(
          affiliateId,
          simSubscriptionId,
          amt,
          simIp,
          simUserAgent,
          undefined,
          selectedAttributionModel
        );
        Alert.alert('Success', 'Simulated recurring subscription sign up! Commission tracked.');
      } catch (err) {
        Alert.alert(
          'Blocked by Fraud Engine',
          err instanceof Error ? err.message : 'Conversion rejected'
        );
      }
    },
    [trackReferral, simSubscriptionId, simAmount, simIp, simUserAgent, selectedAttributionModel]
  );

  const handleSimulationClawback = useCallback(async () => {
    await triggerClawback(simSubscriptionId);
    Alert.alert(
      'Success',
      `Subscription ${simSubscriptionId} cancelled. Commissions within period clawed back successfully.`
    );
  }, [triggerClawback, simSubscriptionId]);

  const handleToggleStatus = useCallback(
    async (affiliateId: string, newStatus: AffiliateStatus) => {
      await updateAffiliateStatus(affiliateId, newStatus);
    },
    [updateAffiliateStatus]
  );

  const renderMetricsCard = () => (
    <Card style={styles.metricsCard}>
      <Text style={styles.metricsTitle}>Real-time Performance Metrics</Text>
      <View style={styles.metricsGrid}>
        <View style={styles.metricItem}>
          <Text style={styles.metricValue}>{metrics.totalClicks || 0}</Text>
          <Text style={styles.metricLabel}>Total Clicks</Text>
        </View>
        <View style={styles.metricItem}>
          <Text style={styles.metricValue}>{metrics.totalReferrals}</Text>
          <Text style={styles.metricLabel}>Conversions</Text>
        </View>
        <View style={styles.metricItem}>
          <Text style={[styles.metricValue, { color: colors.success }]}>
            ${metrics.totalEarnings.toFixed(2)}
          </Text>
          <Text style={styles.metricLabel}>Total Earnings</Text>
        </View>
        <View style={styles.metricItem}>
          <Text style={[styles.metricValue, { color: colors.warning }]}>
            ${metrics.pendingPayout.toFixed(2)}
          </Text>
          <Text style={styles.metricLabel}>Pending Payout</Text>
        </View>
      </View>
      <View style={styles.conversionRow}>
        <Text style={styles.conversionLabel}>Conversion Rate</Text>
        <Text style={styles.conversionValue}>{(metrics.conversionRate || 0).toFixed(1)}%</Text>
      </View>
    </Card>
  );

  const renderAffiliateList = () => (
    <Card style={styles.listCard}>
      <Text style={styles.listTitle}>Referral Configuration & Operations</Text>
      {affiliates.length === 0 ? (
        <Text style={styles.emptyText}>
          No registered programs yet. Join a program below to start earning.
        </Text>
      ) : (
        affiliates.map((affiliate) => {
          const currentProg = programs.find((p) => p.id === affiliate.programId);
          return (
            <View key={affiliate.id} style={styles.affiliateContainer}>
              <View style={styles.affiliateHeader}>
                <View>
                  <Text style={styles.affiliateProgramName}>
                    {currentProg?.name || 'Basic Program'}
                  </Text>
                  <Text style={styles.affiliateCode}>Code: {affiliate.referralCode}</Text>
                </View>
                <View
                  style={[
                    styles.fraudBadge,
                    {
                      backgroundColor:
                        affiliate.fraudStatus === 'flagged'
                          ? 'rgba(239, 68, 68, 0.15)'
                          : affiliate.fraudStatus === 'suspicious'
                            ? 'rgba(245, 158, 11, 0.15)'
                            : 'rgba(16, 185, 129, 0.15)',
                    },
                  ]}>
                  <Text
                    style={[
                      styles.fraudBadgeText,
                      {
                        color:
                          affiliate.fraudStatus === 'flagged'
                            ? colors.error
                            : affiliate.fraudStatus === 'suspicious'
                              ? colors.warning
                              : colors.success,
                      },
                    ]}>
                    {affiliate.fraudStatus === 'flagged'
                      ? '⚠️ Suspended'
                      : affiliate.fraudStatus === 'suspicious'
                        ? '⚠️ Suspicious'
                        : '🛡️ Secure'}
                  </Text>
                </View>
              </View>

              {/* Referral Link & Custom Payout Controls */}
              <View style={styles.referralLinkSection}>
                <Text style={styles.referralLinkLabel} numberOfLines={1}>
                  {affiliate.referralLink}
                </Text>
                <TouchableOpacity
                  style={styles.copyButton}
                  onPress={() => handleCopyLink(affiliate.referralLink || '')}>
                  <Text style={styles.copyButtonText}>Copy Link</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.affiliateStatsRow}>
                <Text style={styles.statMini}>Clicks: {affiliate.clicksCount || 0}</Text>
                <Text style={styles.statMini}>Threshold: ${affiliate.paymentThreshold}</Text>
                <Text style={styles.statMini}>Risk: {affiliate.fraudRiskScore || 0}%</Text>
              </View>

              <View style={styles.actionButtonsRow}>
                <TouchableOpacity
                  style={[
                    styles.payoutActionButton,
                    affiliate.pendingPayout < affiliate.paymentThreshold && styles.disabledButton,
                  ]}
                  onPress={() => handlePayout(affiliate.id)}>
                  <Text style={styles.payoutActionText}>Request Payout</Text>
                </TouchableOpacity>

                {affiliate.status === AffiliateStatus.ACTIVE ? (
                  <TouchableOpacity
                    style={styles.pauseButton}
                    onPress={() => handleToggleStatus(affiliate.id, AffiliateStatus.PAUSED)}>
                    <Text style={styles.pauseButtonText}>Pause</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.resumeButton}
                    onPress={() => handleToggleStatus(affiliate.id, AffiliateStatus.ACTIVE)}>
                    <Text style={styles.resumeButtonText}>Resume</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* SIMULATION BENCH */}
              <View style={styles.simulatorBench}>
                <Text style={styles.simulatorTitle}>Sandbox Simulator Bench</Text>
                <Text style={styles.simulatorSubtitle}>
                  Simulate visitor flow to test multi-touch attribution, fraud mitigation, and churn
                  clawbacks.
                </Text>

                <View style={styles.simInputsRow}>
                  <View style={styles.simInputBox}>
                    <Text style={styles.inputLabel}>Sub ID</Text>
                    <TextInput
                      style={styles.simInput}
                      value={simSubscriptionId}
                      onChangeText={setSimSubscriptionId}
                    />
                  </View>
                  <View style={styles.simInputBox}>
                    <Text style={styles.inputLabel}>Amount ($)</Text>
                    <TextInput
                      style={styles.simInput}
                      value={simAmount}
                      onChangeText={setSimAmount}
                      keyboardType="numeric"
                    />
                  </View>
                </View>

                <View style={styles.simInputsRow}>
                  <View style={styles.simInputBox}>
                    <Text style={styles.inputLabel}>Visitor IP</Text>
                    <TextInput style={styles.simInput} value={simIp} onChangeText={setSimIp} />
                  </View>
                  <View style={styles.simInputBox}>
                    <Text style={styles.inputLabel}>User Agent</Text>
                    <TextInput
                      style={styles.simInput}
                      value={simUserAgent}
                      onChangeText={setSimUserAgent}
                    />
                  </View>
                </View>

                <View style={styles.simButtonsContainer}>
                  <TouchableOpacity
                    style={styles.simBtn}
                    onPress={() => handleSimulationClick(affiliate.referralCode || '')}>
                    <Text style={styles.simBtnText}>1. Sim Click</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.simBtn, { backgroundColor: colors.primary }]}
                    onPress={() => handleSimulationConversion(affiliate.id)}>
                    <Text style={styles.simBtnText}>2. Sim Convert</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.simBtn, { backgroundColor: colors.error }]}
                    onPress={handleSimulationClawback}>
                    <Text style={styles.simBtnText}>3. Sim Churn</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })
      )}
    </Card>
  );

  const renderProgramsCard = () => (
    <Card style={styles.listCard}>
      <Text style={styles.listTitle}>Available Affiliate Programs</Text>
      {programs.map((program) => (
        <TouchableOpacity
          key={program.id}
          style={styles.programItem}
          onPress={() => {
            setSelectedProgram(program.id);
            setProgramModalVisible(true);
          }}>
          <View style={styles.programInfo}>
            <Text style={styles.programName}>{program.name}</Text>
            <Text style={styles.programDescription}>{program.description}</Text>
            <Text style={styles.programSubMeta}>
              Attribution: {program.attributionModel || 'last-touch'} •{' '}
              {program.attributionWindowDays} days cookie
            </Text>
          </View>
          <View style={styles.programRate}>
            <Text style={styles.rateValue}>
              {program.commissionConfig.type === 'percentage'
                ? `${program.commissionConfig.rate}%`
                : program.commissionConfig.type === 'flat'
                  ? `$${program.commissionConfig.rate}`
                  : 'Tiered'}
            </Text>
            <Text style={styles.rateLabel}>Commission</Text>
          </View>
        </TouchableOpacity>
      ))}
    </Card>
  );

  const renderCommissionsList = () => (
    <Card style={styles.listCard}>
      <Text style={styles.listTitle}>Recent Commission Ledger & Clawbacks</Text>
      {commissions.length === 0 ? (
        <Text style={styles.emptyText}>No commissions tracked yet.</Text>
      ) : (
        commissions
          .slice()
          .reverse()
          .slice(0, 5)
          .map((commission) => (
            <View key={commission.id} style={styles.commissionItem}>
              <View style={styles.commissionInfo}>
                <Text style={styles.commissionId}>Sub: {commission.subscriptionId}</Text>
                <Text style={styles.commissionDate}>
                  {new Date(commission.createdAt).toLocaleDateString()}
                </Text>
              </View>
              <View style={styles.commissionAmount}>
                <Text
                  style={[
                    styles.amountValue,
                    commission.isClawbacked && {
                      textDecorationLine: 'line-through',
                      color: colors.error,
                    },
                  ]}>
                  ${commission.amount.toFixed(2)}
                </Text>
                <View
                  style={[
                    styles.commissionStatus,
                    {
                      backgroundColor: commission.isClawbacked
                        ? 'rgba(239, 68, 68, 0.15)'
                        : commission.status === 'paid'
                          ? 'rgba(16, 185, 129, 0.15)'
                          : 'rgba(245, 158, 11, 0.15)',
                    },
                  ]}>
                  <Text
                    style={[
                      styles.commissionStatusText,
                      {
                        color: commission.isClawbacked
                          ? colors.error
                          : commission.status === 'paid'
                            ? colors.success
                            : colors.warning,
                      },
                    ]}>
                    {commission.isClawbacked ? 'Clawed back' : commission.status}
                  </Text>
                </View>
              </View>
            </View>
          ))
      )}
    </Card>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Affiliate & Referral Engine</Text>
          <Text style={styles.subtitle}>
            Create marketing campaigns, track recurring conversions, mitigate fraud, and handle
            payouts.
          </Text>
        </View>

        {renderMetricsCard()}
        {renderAffiliateList()}
        {renderProgramsCard()}
        {renderCommissionsList()}

        <TouchableOpacity
          style={styles.registerButton}
          onPress={() => setProgramModalVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Register as affiliate">
          <Text style={styles.registerButtonText}>Launch New Affiliate Campaign</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Program Config Modal */}
      <Modal
        visible={programModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setProgramModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Configure Affiliate Program</Text>
              <Text style={styles.modalSubtitle}>
                Join a program and configure tracking constraints.
              </Text>

              {programs.map((program) => (
                <TouchableOpacity
                  key={program.id}
                  style={[
                    styles.programOption,
                    selectedProgram === program.id && styles.programOptionSelected,
                  ]}
                  onPress={() => setSelectedProgram(program.id)}>
                  <View style={programOptionInfo}>
                    <Text style={styles.programOptionName}>{program.name}</Text>
                    <Text style={styles.programOptionDesc}>{program.description}</Text>
                  </View>
                  <View
                    style={[
                      styles.radioCircle,
                      selectedProgram === program.id && styles.radioCircleSelected,
                    ]}>
                    {selectedProgram === program.id && <View style={styles.radioInner} />}
                  </View>
                </TouchableOpacity>
              ))}

              <Text style={styles.sectionLabelHeader}>Attribution & Window Parameters</Text>

              <Text style={styles.inputTitleLabel}>Cookie Validity Window (Days)</Text>
              <TextInput
                style={styles.modalTextInput}
                value={customCookieWindow}
                onChangeText={setCustomCookieWindow}
                keyboardType="numeric"
                placeholder="e.g. 30"
              />

              <Text style={styles.inputTitleLabel}>Attribution Model</Text>
              <View style={styles.optionsSelectorRow}>
                {(['first-touch', 'last-touch', 'linear'] as const).map((model) => (
                  <TouchableOpacity
                    key={model}
                    style={[
                      styles.optionSelectorItem,
                      selectedAttributionModel === model && styles.optionSelectorItemSelected,
                    ]}
                    onPress={() => setSelectedAttributionModel(model)}>
                    <Text
                      style={[
                        styles.optionSelectorText,
                        selectedAttributionModel === model && styles.optionSelectorTextActive,
                      ]}>
                      {model}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => setProgramModalVisible(false)}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmButton} onPress={handleRegister}>
                  <Text style={styles.confirmButtonText}>Join Program</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

// Extracted styles from theme safely
const programOptionInfo = {
  flex: 1,
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: spacing.md,
    paddingTop: spacing.lg,
  },
  title: {
    fontSize: typography.h2.fontSize,
    fontWeight: typography.h2.fontWeight,
    color: colors.text,
  },
  subtitle: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    lineHeight: 20,
  },
  metricsCard: {
    padding: spacing.md,
    margin: spacing.md,
    marginTop: 0,
    backgroundColor: colors.surface,
  },
  metricsTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  metricItem: {
    width: '48%',
    alignItems: 'center',
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: borderRadius.md,
  },
  metricValue: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: colors.text,
  },
  metricLabel: {
    fontSize: typography.small.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  conversionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.xs,
  },
  conversionLabel: {
    fontSize: typography.body2.fontSize,
    color: colors.textSecondary,
  },
  conversionValue: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.primary,
  },
  listCard: {
    padding: spacing.md,
    margin: spacing.md,
    marginTop: 0,
    backgroundColor: colors.surface,
  },
  listTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  emptyText: {
    fontSize: typography.body2.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.lg,
    lineHeight: 20,
  },
  affiliateContainer: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  affiliateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  affiliateProgramName: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.text,
  },
  affiliateCode: {
    fontSize: typography.body2.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },
  fraudBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  fraudBadgeText: {
    fontSize: typography.small.fontSize,
    fontWeight: '700',
  },
  referralLinkSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  referralLinkLabel: {
    flex: 1,
    fontSize: typography.small.fontSize,
    color: colors.textSecondary,
  },
  copyButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: borderRadius.sm,
    marginLeft: spacing.sm,
  },
  copyButtonText: {
    color: '#ffffff',
    fontSize: typography.small.fontSize,
    fontWeight: '700',
  },
  affiliateStatsRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    gap: spacing.lg,
  },
  statMini: {
    fontSize: typography.small.fontSize,
    color: colors.textSecondary,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    gap: spacing.md,
  },
  payoutActionButton: {
    backgroundColor: colors.success,
    borderRadius: borderRadius.sm,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  disabledButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  payoutActionText: {
    color: colors.text,
    fontSize: typography.body2.fontSize,
    fontWeight: '700',
  },
  pauseButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.warning,
    justifyContent: 'center',
  },
  pauseButtonText: {
    color: colors.warning,
    fontSize: typography.body2.fontSize,
    fontWeight: '700',
  },
  resumeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.success,
    justifyContent: 'center',
  },
  resumeButtonText: {
    color: colors.success,
    fontSize: typography.body2.fontSize,
    fontWeight: '700',
  },
  simulatorBench: {
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  simulatorTitle: {
    fontSize: typography.body2.fontSize,
    fontWeight: '700',
    color: colors.text,
  },
  simulatorSubtitle: {
    fontSize: typography.small.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  simInputsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  simInputBox: {
    flex: 1,
  },
  inputLabel: {
    fontSize: typography.small.fontSize,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  simInput: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: borderRadius.sm,
    padding: 6,
    color: colors.text,
    fontSize: typography.body2.fontSize,
  },
  simButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  simBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 8,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
  },
  simBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
  },
  programItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  programInfo: {
    flex: 1,
  },
  programName: {
    fontSize: typography.body.fontSize,
    color: colors.text,
    fontWeight: '700',
  },
  programDescription: {
    fontSize: typography.body2.fontSize,
    color: colors.textSecondary,
    marginTop: 4,
  },
  programSubMeta: {
    fontSize: typography.small.fontSize,
    color: colors.primary,
    marginTop: 6,
  },
  programRate: {
    alignItems: 'flex-end',
  },
  rateValue: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.primary,
  },
  rateLabel: {
    fontSize: typography.small.fontSize,
    color: colors.textSecondary,
  },
  commissionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  commissionInfo: {
    flex: 1,
  },
  commissionId: {
    fontSize: typography.body2.fontSize,
    color: colors.text,
    fontWeight: '700',
  },
  commissionDate: {
    fontSize: typography.small.fontSize,
    color: colors.textSecondary,
    marginTop: 4,
  },
  commissionAmount: {
    alignItems: 'flex-end',
  },
  amountValue: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.text,
  },
  commissionStatus: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    marginTop: 4,
  },
  commissionStatusText: {
    color: colors.text,
    fontSize: typography.small.fontSize,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  registerButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    margin: spacing.md,
    alignItems: 'center',
  },
  registerButtonText: {
    color: '#ffffff',
    fontSize: typography.body.fontSize,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalScroll: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    padding: spacing.lg,
  },
  modalTitle: {
    fontSize: typography.h3.fontSize,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  modalSubtitle: {
    fontSize: typography.body2.fontSize,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  programOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  programOptionSelected: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  programOptionName: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.text,
  },
  programOptionDesc: {
    fontSize: typography.body2.fontSize,
    color: colors.textSecondary,
    marginTop: 4,
  },
  radioCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioCircleSelected: {
    borderColor: colors.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  sectionLabelHeader: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  inputTitleLabel: {
    fontSize: typography.small.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  modalTextInput: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: borderRadius.sm,
    padding: 10,
    color: colors.text,
    fontSize: typography.body2.fontSize,
    marginBottom: spacing.sm,
  },
  optionsSelectorRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  optionSelectorItem: {
    flex: 1,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingVertical: 10,
    alignItems: 'center',
  },
  optionSelectorItemSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  optionSelectorText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  optionSelectorTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelButtonText: {
    color: colors.text,
    fontSize: typography.body.fontSize,
    fontWeight: '700',
  },
  confirmButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: colors.background,
    fontSize: typography.body.fontSize,
    fontWeight: '700',
  },
});

export default AffiliateDashboardScreen;
