import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Share,
} from 'react-native';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useSubscriptionStore } from '../store';
import { Card } from '../components/common/Card';
import { TrialOptimizationService } from '../services/trialOptimizationService';
import { TrialRecord } from '../types/trialOptimization';

type TabType = 'analytics' | 'trials' | 'automation' | 'notifications' | 'reporting';

const TrialOptimizationDashboard: React.FC = () => {
  const { subscriptions } = useSubscriptionStore();
  const [activeTab, setActiveTab] = useState<TabType>('analytics');
  const [trials, setTrials] = useState<TrialRecord[]>([]);
  const [summary, setSummary] = useState(() => TrialOptimizationService.getAnalyticsSummary());

  const handleRefreshTrials = () => {
    const newSummary = TrialOptimizationService.processTrials(subscriptions);
    setSummary(newSummary);
    setTrials([...TrialOptimizationService.getTrials()]);
  };

  useEffect(() => {
    handleRefreshTrials();
  }, [subscriptions]);

  const handleConvertTrial = (trialId: string) => {
    TrialOptimizationService.convertTrialToPaid(trialId, 'discount_incentive');
    setTrials([...TrialOptimizationService.getTrials()]);
    setSummary(TrialOptimizationService.getAnalyticsSummary(subscriptions));
  };

  const handleExtendTrial = (trialId: string) => {
    TrialOptimizationService.applyExtension(trialId, 'ext-high-engagement');
    setTrials([...TrialOptimizationService.getTrials()]);
    setSummary(TrialOptimizationService.getAnalyticsSummary(subscriptions));
  };

  const handleExportReport = async (format: 'csv' | 'json') => {
    const reportContent = TrialOptimizationService.generateReport(format);
    try {
      await Share.share({
        message: reportContent,
        title: `Trial_Optimization_Report.${format}`,
      });
    } catch (err) {
      console.log('Export failed', err);
    }
  };

  const conversionColor = useMemo(() => {
    if (summary.trialConversionRate >= 30) return '#10B981';
    if (summary.trialConversionRate >= 15) return '#F59E0B';
    return '#EF4444';
  }, [summary.trialConversionRate]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Trial Optimization</Text>
          <Text style={styles.subtitle}>Conversion Tracking & Trial-to-Paid Automation</Text>
        </View>

        {/* Navigation Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
          {(['analytics', 'trials', 'automation', 'notifications', 'reporting'] as TabType[]).map(
            (tab) => (
              <TouchableOpacity
                key={tab}
                style={[styles.tabItem, activeTab === tab && styles.tabItemActive]}
                onPress={() => setActiveTab(tab)}>
                <Text
                  style={[
                    styles.tabText,
                    activeTab === tab && styles.tabTextActive,
                  ]}>
                  {tab.toUpperCase()}
                </Text>
              </TouchableOpacity>
            )
          )}
        </ScrollView>

        {/* Hero Score Card */}
        <Card style={styles.scoreCard}>
          <View style={styles.scoreHeader}>
            <View>
              <Text style={styles.scoreLabel}>Trial Conversion Rate</Text>
              <Text style={[styles.scoreValue, { color: conversionColor }]}>
                {summary.trialConversionRate}%
              </Text>
            </View>
            <TouchableOpacity style={styles.runBtn} onPress={handleRefreshTrials}>
              <Text style={styles.runBtnText}>Refresh Data</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.lastRunText}>
            Revenue From Converted Trials: ${summary.revenueFromConversions.toFixed(2)}
          </Text>
        </Card>

        {/* Trial Analytics Grid */}
        {(activeTab === 'analytics' || activeTab === 'trials') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Trial Analytics</Text>
            <View style={styles.statsGrid}>
              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Total Trials Started</Text>
                <Text style={styles.statValue}>{summary.totalTrialsStarted}</Text>
              </Card>

              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Active Trials</Text>
                <Text style={[styles.statValue, { color: colors.primary }]}>
                  {summary.activeTrialsCount}
                </Text>
              </Card>

              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Converted to Paid</Text>
                <Text style={[styles.statValue, { color: '#10B981' }]}>
                  {summary.convertedTrialsCount}
                </Text>
              </Card>

              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Extended Trials</Text>
                <Text style={[styles.statValue, { color: '#F59E0B' }]}>
                  {summary.extendedTrialsCount}
                </Text>
              </Card>
            </View>
          </View>
        )}

        {/* Active & Converted Trials */}
        {(activeTab === 'analytics' || activeTab === 'trials') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Active Trial Conversion Management</Text>
            {trials.length === 0 ? (
              <Card style={styles.emptyCard}>
                <Text style={styles.emptyText}>No active trials found.</Text>
              </Card>
            ) : (
              trials.map((trial) => (
                <Card key={trial.id} style={styles.alertCard}>
                  <View style={styles.alertHeader}>
                    <View style={styles.flex1}>
                      <Text style={styles.alertTitle}>
                        Trial #{trial.id.slice(0, 8)} ({trial.status.toUpperCase()})
                      </Text>
                      <Text style={styles.alertMessage}>
                        Engagement Score: {trial.engagementScore}/100 • Extensions: {trial.extensionsGranted}
                      </Text>
                    </View>
                    {trial.status !== 'converted' && (
                      <View style={styles.btnGroup}>
                        <TouchableOpacity
                          style={styles.extBtn}
                          onPress={() => handleExtendTrial(trial.id)}>
                          <Text style={styles.extBtnText}>+7 Days</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.ackBtn}
                          onPress={() => handleConvertTrial(trial.id)}>
                          <Text style={styles.ackBtnText}>Convert</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </Card>
              ))
            )}
          </View>
        )}

        {/* Automation Rules */}
        {(activeTab === 'analytics' || activeTab === 'automation') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Trial Extension Rules & Automation</Text>
            <Card style={styles.cardSection}>
              {TrialOptimizationService.getExtensionRules().map((rule) => (
                <View key={rule.id} style={styles.auditRow}>
                  <View style={styles.auditMain}>
                    <Text style={styles.auditAction}>{rule.name}</Text>
                    <Text style={styles.auditDetails}>Condition: {rule.condition}</Text>
                  </View>
                  <Text style={styles.auditTime}>+{rule.extensionDays} Days</Text>
                </View>
              ))}
            </Card>
          </View>
        )}

        {/* Trial Notifications */}
        {(activeTab === 'analytics' || activeTab === 'notifications') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Trial Expiration Notifications</Text>
            {TrialOptimizationService.getNotifications().map((notif) => (
              <Card key={notif.id} style={styles.notifCard}>
                <Text style={styles.alertTitle}>{notif.title}</Text>
                <Text style={styles.alertMessage}>{notif.message}</Text>
                <Text style={styles.notifSub}>
                  Sent {notif.daysBeforeExpiration} day(s) before expiration
                </Text>
              </Card>
            ))}
          </View>
        )}

        {/* Trial Reporting */}
        {(activeTab === 'analytics' || activeTab === 'reporting') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Trial Reporting</Text>
            <Card style={styles.cardSection}>
              <Text style={styles.chartTitle}>Export Trial Conversion Performance</Text>
              <Text style={styles.alertMessage}>
                Download standardized trial conversion metrics, extension logs, and subscriber cohort data.
              </Text>
              <View style={styles.exportBtnRow}>
                <TouchableOpacity
                  style={styles.exportBtn}
                  onPress={() => handleExportReport('csv')}>
                  <Text style={styles.exportBtnText}>Export CSV</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.exportBtn, styles.exportBtnSecondary]}
                  onPress={() => handleExportReport('json')}>
                  <Text style={styles.exportBtnTextSecondary}>Export JSON</Text>
                </TouchableOpacity>
              </View>
            </Card>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.md,
  },
  header: {
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold as any,
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  tabBar: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  tabItem: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    marginRight: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabItemActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.surface,
  },
  scoreCard: {
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  scoreHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scoreLabel: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
  },
  scoreValue: {
    fontSize: typography.fontSize['3xl'],
    fontWeight: typography.fontWeight.bold as any,
  },
  runBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },
  runBtnText: {
    color: colors.surface,
    fontWeight: typography.fontWeight.bold as any,
    fontSize: typography.fontSize.xs,
  },
  lastRunText: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statCard: {
    width: '48%',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  statLabel: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  statValue: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.textPrimary,
  },
  emptyCard: {
    padding: spacing.md,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: typography.fontSize.sm,
  },
  alertCard: {
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  alertHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  flex1: {
    flex: 1,
  },
  alertTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.textPrimary,
  },
  alertMessage: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  btnGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  extBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 4,
    paddingHorizontal: spacing.xs,
    borderRadius: borderRadius.sm,
    marginRight: spacing.xs,
  },
  extBtnText: {
    fontSize: 10,
    color: colors.textPrimary,
    fontWeight: 'bold',
  },
  ackBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  ackBtnText: {
    fontSize: 10,
    color: colors.surface,
    fontWeight: 'bold',
  },
  cardSection: {
    padding: spacing.md,
  },
  auditRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  auditMain: {
    flex: 1,
  },
  auditAction: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.textPrimary,
  },
  auditDetails: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  auditTime: {
    fontSize: 11,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.primary,
  },
  notifCard: {
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  notifSub: {
    fontSize: 10,
    color: colors.primary,
    marginTop: 4,
  },
  chartTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  exportBtnRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    justifyContent: 'space-between',
  },
  exportBtn: {
    flex: 0.48,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  exportBtnText: {
    color: colors.surface,
    fontWeight: typography.fontWeight.bold as any,
    fontSize: typography.fontSize.xs,
  },
  exportBtnSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  exportBtnTextSecondary: {
    color: colors.textPrimary,
    fontWeight: typography.fontWeight.bold as any,
    fontSize: typography.fontSize.xs,
  },
});

export default TrialOptimizationDashboard;
