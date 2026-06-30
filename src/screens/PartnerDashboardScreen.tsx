import React, { useState, useMemo, useCallback } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { FormScreen } from '../components/common/ScreenTemplates';
import { spacing, typography, borderRadius } from '../utils/constants';
import { useThemeColors } from '../hooks/useThemeColors';
import { usePartnerStore } from '../store/partnerStore';
import type { Partner, SplitType, PartnerPayoutSchedule } from '../types/partner';
import { SplitEngine } from '../services/partnerService';

type Tab = 'partners' | 'splits' | 'payouts';

const PartnerDashboardScreen: React.FC = () => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    partners,
    splitConfigurations,
    payoutRecords,
    getPartnerEarnings,
    getSubscriptionSplits,
  } = usePartnerStore();

  const [activeTab, setActiveTab] = useState<Tab>('partners');
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);

  const partnerEarnings = useMemo(() => {
    if (!selectedPartnerId) return null;
    return getPartnerEarnings(selectedPartnerId);
  }, [selectedPartnerId, getPartnerEarnings, payoutRecords]);

  const totalPendingPayouts = useMemo(
    () => partners.reduce((sum, p) => sum + getPartnerEarnings(p.id).pendingPayouts, 0),
    [partners, getPartnerEarnings]
  );

  const totalCompletedPayouts = useMemo(
    () => partners.reduce((sum, p) => sum + getPartnerEarnings(p.id).completedPayouts, 0),
    [partners, getPartnerEarnings]
  );

  const renderPartnersTab = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Partners</Text>
      {partners.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyText}>No partners enrolled yet.</Text>
        </Card>
      ) : (
        partners.map((partner) => {
          const earnings = getPartnerEarnings(partner.id);
          const isSelected = selectedPartnerId === partner.id;
          return (
            <TouchableOpacity
              key={partner.id}
              onPress={() => setSelectedPartnerId(isSelected ? null : partner.id)}>
              <Card style={[styles.partnerCard, isSelected && styles.partnerCardSelected]}>
                <View style={styles.partnerHeader}>
                  <View style={styles.partnerInfo}>
                    <Text style={styles.partnerName}>{partner.name}</Text>
                    <Text style={styles.partnerMeta}>
                      {partner.company ?? 'Individual'} · {partner.email}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusBadge,
                      { backgroundColor: getStatusColor(partner.status) },
                    ]}>
                    <Text style={styles.statusText}>{partner.status}</Text>
                  </View>
                </View>
                <View style={styles.partnerMetrics}>
                  <View style={styles.metric}>
                    <Text style={styles.metricLabel}>Total Earnings</Text>
                    <Text style={styles.metricValue}>${earnings.totalEarnings.toFixed(2)}</Text>
                  </View>
                  <View style={styles.metric}>
                    <Text style={styles.metricLabel}>Pending</Text>
                    <Text style={[styles.metricValue, { color: colors.status.warning }]}>
                      ${earnings.pendingPayouts.toFixed(2)}
                    </Text>
                  </View>
                  <View style={styles.metric}>
                    <Text style={styles.metricLabel}>Paid Out</Text>
                    <Text style={[styles.metricValue, { color: colors.success }]}>
                      ${earnings.completedPayouts.toFixed(2)}
                    </Text>
                  </View>
                </View>
                {isSelected && (
                  <View style={styles.partnerDetail}>
                    <Text style={styles.detailLabel}>Onboarded</Text>
                    <Text style={styles.detailValue}>
                      {new Date(partner.onboardedAt).toLocaleDateString()}
                    </Text>
                    {partner.paymentAddress && (
                      <>
                        <Text style={styles.detailLabel}>Payment Address</Text>
                        <Text style={styles.detailValue}>{partner.paymentAddress}</Text>
                      </>
                    )}
                    {partner.taxId && (
                      <>
                        <Text style={styles.detailLabel}>Tax ID</Text>
                        <Text style={styles.detailValue}>{partner.taxId}</Text>
                      </>
                    )}
                  </View>
                )}
              </Card>
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );

  const renderSplitsTab = () => {
    const subscriptionIds = [...new Set(splitConfigurations.map((c) => c.subscriptionId))];

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Split Configurations</Text>
        {subscriptionIds.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyText}>No split configurations found.</Text>
          </Card>
        ) : (
          subscriptionIds.map((subId) => {
            const configs = getSubscriptionSplits(subId);
            return (
              <Card key={subId} style={styles.configCard}>
                <Text style={styles.configTitle}>Subscription: {subId}</Text>
                {configs.map((config) => (
                  <View key={config.id} style={styles.configRow}>
                    <View style={styles.configInfo}>
                      <Text style={styles.configType}>{config.splitType.toUpperCase()}</Text>
                      <Text style={styles.configPartner}>Partner: {config.partnerId}</Text>
                      <Text style={styles.configSchedule}>Schedule: {config.payoutSchedule}</Text>
                      {config.percentage !== undefined && (
                        <Text style={styles.configValue}>Split: {config.percentage}%</Text>
                      )}
                      {config.fixedAmount !== undefined && (
                        <Text style={styles.configValue}>
                          Split: {config.currency} {config.fixedAmount.toFixed(2)}
                        </Text>
                      )}
                    </View>
                    <View
                      style={[styles.activeIndicator, config.isActive && styles.activeIndicatorOn]}
                    />
                  </View>
                ))}
              </Card>
            );
          })
        )}
      </View>
    );
  };

  const renderPayoutsTab = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Recent Payouts</Text>
      {payoutRecords.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyText}>No payout records yet.</Text>
        </Card>
      ) : (
        payoutRecords
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 20)
          .map((payout) => (
            <Card key={payout.id} style={styles.payoutCard}>
              <View style={styles.payoutHeader}>
                <Text style={styles.payoutPartner}>{payout.partnerId}</Text>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: getPayoutStatusColor(payout.status) },
                  ]}>
                  <Text style={styles.statusText}>{payout.status}</Text>
                </View>
              </View>
              <Text style={styles.payoutAmount}>
                {payout.currency} {payout.netAmount.toFixed(2)}
              </Text>
              <Text style={styles.payoutMeta}>
                Gross: {payout.currency} {payout.grossAmount.toFixed(2)} · Fee: {payout.currency}{' '}
                {payout.platformFee.toFixed(2)}
              </Text>
              <Text style={styles.payoutMeta}>{new Date(payout.createdAt).toLocaleString()}</Text>
            </Card>
          ))
      )}
    </View>
  );

  const getStatusColor = (status: PartnerStatus) => {
    switch (status) {
      case 'verified':
        return colors.success;
      case 'pending':
        return colors.warning;
      case 'suspended':
        return colors.error;
      case 'rejected':
        return colors.textSecondary;
      default:
        return colors.textSecondary;
    }
  };

  const getPayoutStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return colors.success;
      case 'pending':
        return colors.warning;
      case 'processing':
        return colors.primary;
      case 'failed':
        return colors.error;
      default:
        return colors.textSecondary;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Partner Dashboard</Text>
          <Text style={styles.subtitle}>
            Manage collaborators, revenue splits, and automated payouts.
          </Text>
        </View>

        <View style={styles.summaryRow}>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Partners</Text>
            <Text style={[styles.summaryValue, { color: colors.primary }]}>{partners.length}</Text>
          </Card>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Pending Payouts</Text>
            <Text style={[styles.summaryValue, { color: colors.status.warning }]}>
              ${totalPendingPayouts.toFixed(2)}
            </Text>
          </Card>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Completed</Text>
            <Text style={[styles.summaryValue, { color: colors.success }]}>
              ${totalCompletedPayouts.toFixed(2)}
            </Text>
          </Card>
        </View>

        <View style={styles.tabRow}>
          {(['partners', 'splits', 'payouts'] as Tab[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]}
              onPress={() => setActiveTab(tab)}>
              <Text style={[styles.tabBtnText, activeTab === tab && styles.tabBtnTextActive]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {activeTab === 'partners' && renderPartnersTab()}
        {activeTab === 'splits' && renderSplitsTab()}
        {activeTab === 'payouts' && renderPayoutsTab()}
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
    scrollView: {
      flex: 1,
    },
    header: {
      padding: spacing.lg,
      paddingBottom: spacing.md,
    },
    title: {
      ...typography.h1,
      color: colors.text.primary,
      marginBottom: spacing.xs,
    },
    subtitle: {
      ...typography.body,
      color: colors.textSecondary,
    },
    summaryRow: {
      flexDirection: 'row',
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
      gap: spacing.md,
    },
    summaryCard: {
      flex: 1,
      alignItems: 'center',
    },
    summaryLabel: {
      ...typography.caption,
      color: colors.textSecondary,
      marginBottom: spacing.xs,
    },
    summaryValue: {
      ...typography.h2,
      fontWeight: '700',
    },
    tabRow: {
      flexDirection: 'row',
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
      gap: spacing.sm,
    },
    tabBtn: {
      flex: 1,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border.default,
      alignItems: 'center',
    },
    tabBtnActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    tabBtnText: {
      ...typography.body,
      color: colors.text.primary,
    },
    tabBtnTextActive: {
      color: colors.text.inverse,
      fontWeight: '600',
    },
    section: {
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.xl,
    },
    sectionTitle: {
      ...typography.h3,
      color: colors.text.primary,
      marginBottom: spacing.md,
    },
    emptyCard: {
      padding: spacing.lg,
      alignItems: 'center',
    },
    emptyText: {
      ...typography.body,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    partnerCard: {
      marginBottom: spacing.md,
    },
    partnerCardSelected: {
      borderColor: colors.primary,
      borderWidth: 2,
    },
    partnerHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    partnerInfo: {
      flex: 1,
    },
    partnerName: {
      ...typography.body,
      color: colors.text.primary,
      fontWeight: '700',
      marginBottom: spacing.xs,
    },
    partnerMeta: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    statusBadge: {
      paddingVertical: 4,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.full,
    },
    statusText: {
      ...typography.caption,
      color: colors.text.inverse,
      fontWeight: '700',
      textTransform: 'uppercase',
    },
    partnerMetrics: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: spacing.md,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border.default,
    },
    metric: {
      alignItems: 'center',
    },
    metricLabel: {
      ...typography.caption,
      color: colors.textSecondary,
      marginBottom: spacing.xs,
    },
    metricValue: {
      ...typography.body,
      color: colors.text.primary,
      fontWeight: '600',
    },
    partnerDetail: {
      marginTop: spacing.md,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border.default,
      gap: spacing.xs,
    },
    detailLabel: {
      ...typography.caption,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    detailValue: {
      ...typography.body,
      color: colors.text.primary,
    },
    configCard: {
      marginBottom: spacing.md,
    },
    configTitle: {
      ...typography.body,
      color: colors.text.primary,
      fontWeight: '700',
      marginBottom: spacing.sm,
    },
    configRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    configInfo: {
      flex: 1,
    },
    configType: {
      ...typography.body,
      color: colors.text.primary,
      fontWeight: '600',
    },
    configPartner: {
      ...typography.caption,
      color: colors.textSecondary,
      marginTop: 2,
    },
    configSchedule: {
      ...typography.caption,
      color: colors.textSecondary,
      marginTop: 2,
    },
    configValue: {
      ...typography.caption,
      color: colors.primary,
      fontWeight: '600',
      marginTop: 2,
    },
    activeIndicator: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.textSecondary,
    },
    activeIndicatorOn: {
      backgroundColor: colors.success,
    },
    payoutCard: {
      marginBottom: spacing.md,
    },
    payoutHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    payoutPartner: {
      ...typography.body,
      color: colors.text.primary,
      fontWeight: '700',
    },
    payoutAmount: {
      ...typography.h3,
      color: colors.text.primary,
      marginBottom: spacing.xs,
    },
    payoutMeta: {
      ...typography.caption,
      color: colors.textSecondary,
      marginTop: spacing.xs,
    },
  });
}

export default PartnerDashboardScreen;
