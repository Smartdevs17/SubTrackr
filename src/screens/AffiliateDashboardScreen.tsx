import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  FlatList,
} from 'react-native';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useAffiliateStore } from '../store/affiliateStore';
import { useWalletStore } from '../store/walletStore';
import { Card } from '../components/common/Card';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { AffiliateStatus, AffiliateProgram, Commission } from '../types/affiliate';

const AffiliateDashboardScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {
    affiliates,
    programs,
    commissions,
    metrics,
    isLoading,
    error,
    registerAffiliate,
    trackReferral,
    calculateCommission,
    payoutCommission,
    updateAffiliateStatus,
    getMetrics,
  } = useAffiliateStore();
  const { address } = useWalletStore();

  const [programModalVisible, setProgramModalVisible] = useState(false);
  const [selectedProgram, setSelectedProgram] = useState<string>('');

  useEffect(() => {
    const currentMetrics = getMetrics();
    useAffiliateStore.setState({ metrics: currentMetrics });
  }, [affiliates, commissions, getMetrics]);

  const handleRegister = useCallback(async () => {
    if (!address) {
      Alert.alert('Error', 'Please connect your wallet first');
      return;
    }
    if (!selectedProgram) {
      Alert.alert('Error', 'Please select a program');
      return;
    }
    await registerAffiliate(address, selectedProgram);
    setProgramModalVisible(false);
    Alert.alert('Success', 'You are now an affiliate!');
  }, [address, selectedProgram, registerAffiliate]);

  const handlePayout = useCallback(
    async (affiliateId: string) => {
      const affiliate = affiliates.find((a) => a.id === affiliateId);
      if (!affiliate || affiliate.pendingPayout < affiliate.paymentThreshold) {
        Alert.alert(
          'Minimum Threshold',
          `You need at least $${affiliate?.paymentThreshold} to request a payout`
        );
        return;
      }
      await payoutCommission(affiliateId);
      Alert.alert('Success', 'Payout requested!');
    },
    [affiliates, payoutCommission]
  );

  const handleToggleStatus = useCallback(
    async (affiliateId: string, newStatus: AffiliateStatus) => {
      await updateAffiliateStatus(affiliateId, newStatus);
    },
    [updateAffiliateStatus]
  );

  const renderMetricsCard = () => (
    <Card style={styles.metricsCard}>
      <Text style={styles.metricsTitle}>Performance Overview</Text>
      <View style={styles.metricsGrid}>
        <View style={styles.metricItem}>
          <Text style={styles.metricValue}>{metrics.totalReferrals}</Text>
          <Text style={styles.metricLabel}>Total Referrals</Text>
        </View>
        <View style={styles.metricItem}>
          <Text style={styles.metricValue}>{metrics.activeReferrals}</Text>
          <Text style={styles.metricLabel}>Active</Text>
        </View>
        <View style={styles.metricItem}>
          <Text style={styles.metricValue}>${metrics.totalEarnings.toFixed(2)}</Text>
          <Text style={styles.metricLabel}>Total Earnings</Text>
        </View>
        <View style={styles.metricItem}>
          <Text style={styles.metricValue}>${metrics.pendingPayout.toFixed(2)}</Text>
          <Text style={styles.metricLabel}>Pending</Text>
        </View>
      </View>
      <View style={styles.conversionRow}>
        <Text style={styles.conversionLabel}>Conversion Rate</Text>
        <Text style={styles.conversionValue}>{metrics.conversionRate.toFixed(1)}%</Text>
      </View>
    </Card>
  );

  const renderAffiliateList = () => (
    <Card style={styles.listCard}>
      <Text style={styles.listTitle}>Your Affiliates</Text>
      {affiliates.length === 0 ? (
        <Text style={styles.emptyText}>No affiliates yet</Text>
      ) : (
        affiliates.map((affiliate) => (
          <View key={affiliate.id} style={styles.affiliateItem}>
            <View style={styles.affiliateInfo}>
              <Text style={styles.affiliateAddress}>
                {affiliate.referrerAddress.slice(0, 6)}...
                {affiliate.referrerAddress.slice(-4)}
              </Text>
              <View style={styles.affiliateStats}>
                <Text style={styles.affiliateStat}>
                  {affiliate.totalReferrals} referrals
                </Text>
                <Text style={styles.affiliateStat}>
                  ${affiliate.totalEarnings.toFixed(2)} earned
                </Text>
              </View>
            </View>
            <View style={styles.affiliateActions}>
              <View
                style={[
                  styles.statusBadge,
                  {
                    backgroundColor:
                      affiliate.status === AffiliateStatus.ACTIVE
                        ? colors.success
                        : affiliate.status === AffiliateStatus.PAUSED
                        ? colors.warning
                        : colors.danger,
                  },
                ]}>
                <Text style={styles.statusBadgeText}>{affiliate.status}</Text>
              </View>
              {affiliate.status === AffiliateStatus.ACTIVE ? (
                <TouchableOpacity
                  style={styles.pauseButton}
                  onPress={() =>
                    handleToggleStatus(affiliate.id, AffiliateStatus.PAUSED)
                  }>
                  <Text style={styles.pauseButtonText}>Pause</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.resumeButton}
                  onPress={() =>
                    handleToggleStatus(affiliate.id, AffiliateStatus.ACTIVE)
                  }>
                  <Text style={styles.resumeButtonText}>Resume</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))
      )}
    </Card>
  );

  const renderProgramsCard = () => (
    <Card style={styles.listCard}>
      <Text style={styles.listTitle}>Available Programs</Text>
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
          </View>
          <View style={styles.programRate}>
            <Text style={styles.rateValue}>
              {program.commissionConfig.type === 'percentage'
                ? `${program.commissionConfig.rate}%`
                : program.commissionConfig.type === 'flat'
                ? `$${program.commissionConfig.rate}`
                : 'Tiered'}
            </Text>
            <Text style={styles.rateLabel}>commission</Text>
          </View>
        </TouchableOpacity>
      ))}
    </Card>
  );

  const renderCommissionsList = () => (
    <Card style={styles.listCard}>
      <Text style={styles.listTitle}>Recent Commissions</Text>
      {commissions.length === 0 ? (
        <Text style={styles.emptyText}>No commissions yet</Text>
      ) : (
        commissions.slice(0, 5).map((commission) => (
          <View key={commission.id} style={styles.commissionItem}>
            <View style={styles.commissionInfo}>
              <Text style={styles.commissionId}>
                Sub: {commission.subscriptionId.slice(0, 8)}...
              </Text>
              <Text style={styles.commissionDate}>
                {new Date(commission.createdAt).toLocaleDateString()}
              </Text>
            </View>
            <View style={styles.commissionAmount}>
              <Text style={styles.amountValue}>${commission.amount.toFixed(2)}</Text>
              <View
                style={[
                  styles.commissionStatus,
                  {
                    backgroundColor:
                      commission.status === 'paid'
                        ? colors.success
                        : commission.status === 'approved'
                        ? colors.warning
                        : colors.textSecondary,
                  },
                ]}>
                <Text style={styles.commissionStatusText}>{commission.status}</Text>
              </View>
            </View>
          </View>
        ))
      )}
    </Card>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Affiliate Dashboard</Text>
          <Text style={styles.subtitle}>
            Track referrals and earn commissions
          </Text>
        </View>

        {renderMetricsCard()}
        {renderProgramsCard()}
        {renderAffiliateList()}
        {renderCommissionsList()}

        <TouchableOpacity
          style={styles.registerButton}
          onPress={() => setProgramModalVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Register as affiliate">
          <Text style={styles.registerButtonText}>Become an Affiliate</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={programModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setProgramModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Program</Text>
            <Text style={styles.modalSubtitle}>
              Choose an affiliate program to join
            </Text>

            {programs.map((program) => (
              <TouchableOpacity
                key={program.id}
                style={[
                  styles.programOption,
                  selectedProgram === program.id && styles.programOptionSelected,
                ]}
                onPress={() => setSelectedProgram(program.id)}>
                <View style={styles.programOptionInfo}>
                  <Text style={styles.programOptionName}>{program.name}</Text>
                  <Text style={styles.programOptionDesc}>
                    {program.description}
                  </Text>
                </View>
                <View
                  style={[
                    styles.radioCircle,
                    selectedProgram === program.id && styles.radioCircleSelected,
                  ]}>
                  {selectedProgram === program.id && (
                    <View style={styles.radioInner} />
                  )}
                </View>
              </TouchableOpacity>
            ))}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setProgramModalVisible(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmButton}
                onPress={handleRegister}>
                <Text style={styles.confirmButtonText}>Join Program</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontSize: typography.fontSizeMd,
  },
  header: {
    padding: spacing.md,
    paddingTop: spacing.lg,
  },
  title: {
    fontSize: typography.fontSizeXl,
    fontWeight: typography.fontWeightBold,
    color: colors.text,
  },
  subtitle: {
    fontSize: typography.fontSizeMd,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  metricsCard: {
    padding: spacing.md,
    margin: spacing.md,
    marginTop: 0,
  },
  metricsTitle: {
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
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
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
  },
  metricValue: {
    fontSize: typography.fontSizeLg,
    fontWeight: typography.fontWeightBold,
    color: colors.text,
  },
  metricLabel: {
    fontSize: typography.fontSizeSm,
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
  },
  conversionLabel: {
    fontSize: typography.fontSizeMd,
    color: colors.textSecondary,
  },
  conversionValue: {
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
    color: colors.primary,
  },
  listCard: {
    padding: spacing.md,
    margin: spacing.md,
    marginTop: 0,
  },
  listTitle: {
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  emptyText: {
    fontSize: typography.fontSizeMd,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  affiliateItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  affiliateInfo: {
    flex: 1,
  },
  affiliateAddress: {
    fontSize: typography.fontSizeMd,
    color: colors.text,
    fontFamily: typography.fontFamilyMono,
  },
  affiliateStats: {
    flexDirection: 'row',
    marginTop: spacing.xs,
    gap: spacing.md,
  },
  affiliateStat: {
    fontSize: typography.fontSizeSm,
    color: colors.textSecondary,
  },
  affiliateActions: {
    alignItems: 'flex-end',
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.xs,
  },
  statusBadgeText: {
    color: colors.text,
    fontSize: typography.fontSizeXs,
    fontWeight: typography.fontWeightMedium,
    textTransform: 'capitalize',
  },
  pauseButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  pauseButtonText: {
    color: colors.warning,
    fontSize: typography.fontSizeSm,
  },
  resumeButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.success,
  },
  resumeButtonText: {
    color: colors.success,
    fontSize: typography.fontSizeSm,
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
    fontSize: typography.fontSizeMd,
    color: colors.text,
    fontWeight: typography.fontWeightMedium,
  },
  programDescription: {
    fontSize: typography.fontSizeSm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  programRate: {
    alignItems: 'flex-end',
  },
  rateValue: {
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
    color: colors.primary,
  },
  rateLabel: {
    fontSize: typography.fontSizeXs,
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
    fontSize: typography.fontSizeSm,
    color: colors.text,
    fontFamily: typography.fontFamilyMono,
  },
  commissionDate: {
    fontSize: typography.fontSizeXs,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  commissionAmount: {
    alignItems: 'flex-end',
  },
  amountValue: {
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
    color: colors.text,
  },
  commissionStatus: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    marginTop: spacing.xs,
  },
  commissionStatusText: {
    color: colors.text,
    fontSize: typography.fontSizeXs,
    fontWeight: typography.fontWeightMedium,
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
    color: colors.text,
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    padding: spacing.lg,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: typography.fontSizeLg,
    fontWeight: typography.fontWeightBold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  modalSubtitle: {
    fontSize: typography.fontSizeMd,
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
  },
  programOptionSelected: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  programOptionInfo: {
    flex: 1,
  },
  programOptionName: {
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightMedium,
    color: colors.text,
  },
  programOptionDesc: {
    fontSize: typography.fontSizeSm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
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
  },
  cancelButtonText: {
    color: colors.text,
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightMedium,
  },
  confirmButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: colors.text,
    fontSize: typography.fontSizeMd,
    fontWeight: typography.fontWeightBold,
  },
});

export default AffiliateDashboardScreen;