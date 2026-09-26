import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Share,
  Switch,
} from 'react-native';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useSubscriptionStore } from '../store';
import { Card } from '../components/common/Card';
import { ReconciliationService } from '../services/reconciliationService';
import { ReconciliationMatch, ScheduleFrequency } from '../types/reconciliation';

type TabType = 'analytics' | 'exceptions' | 'scheduling' | 'reporting';

const PaymentReconciliationDashboard: React.FC = () => {
  const { subscriptions } = useSubscriptionStore();
  const [activeTab, setActiveTab] = useState<TabType>('analytics');
  const [matches, setMatches] = useState<ReconciliationMatch[]>([]);
  const [schedule, setSchedule] = useState(() => ReconciliationService.getSchedule());
  const [summary, setSummary] = useState(() => ReconciliationService.getSummary());

  const handleRunReconciliation = () => {
    const newSummary = ReconciliationService.runAutomatedReconciliation(subscriptions);
    setSummary(newSummary);
    setMatches([...ReconciliationService.getMatches()]);
  };

  useEffect(() => {
    handleRunReconciliation();
  }, [subscriptions]);

  const handleResolveException = (matchId: string) => {
    ReconciliationService.resolveException(matchId, 'fee_deduction', 'Manually resolved variance.');
    setMatches([...ReconciliationService.getMatches()]);
    setSummary(ReconciliationService.getSummary());
  };

  const handleToggleAutoResolve = (val: boolean) => {
    const updated = ReconciliationService.updateSchedule({ autoResolveMinorDiscrepancies: val });
    setSchedule(updated);
  };

  const handleFrequencyChange = (freq: ScheduleFrequency) => {
    const updated = ReconciliationService.updateSchedule({ frequency: freq });
    setSchedule(updated);
  };

  const handleExportReport = async (format: 'csv' | 'json') => {
    const reportContent = ReconciliationService.generateReport(format);
    try {
      await Share.share({
        message: reportContent,
        title: `Reconciliation_Report.${format}`,
      });
    } catch (err) {
      console.log('Export failed', err);
    }
  };

  const matchRateColor = useMemo(() => {
    if (summary.matchRatePercentage >= 90) return '#10B981';
    if (summary.matchRatePercentage >= 75) return '#F59E0B';
    return '#EF4444';
  }, [summary.matchRatePercentage]);

  const exceptions = useMemo(
    () => matches.filter((m) => m.status === 'exception' || m.status === 'unmatched'),
    [matches]
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Payment Reconciliation</Text>
          <Text style={styles.subtitle}>Automated Matching & Exception Resolution</Text>
        </View>

        {/* Navigation Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
          {(['analytics', 'exceptions', 'scheduling', 'reporting'] as TabType[]).map((tab) => (
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
          ))}
        </ScrollView>

        {/* Analytics Card */}
        <Card style={styles.scoreCard}>
          <View style={styles.scoreHeader}>
            <View>
              <Text style={styles.scoreLabel}>Match Rate Percentage</Text>
              <Text style={[styles.scoreValue, { color: matchRateColor }]}>
                {summary.matchRatePercentage}%
              </Text>
            </View>
            <TouchableOpacity style={styles.runBtn} onPress={handleRunReconciliation}>
              <Text style={styles.runBtnText}>Reconcile Now</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.lastRunText}>
            Last Reconciled: {new Date(summary.lastReconciledAt).toLocaleTimeString()}
          </Text>
        </Card>

        {/* Analytics Overview */}
        {(activeTab === 'analytics' || activeTab === 'exceptions') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Reconciliation Analytics</Text>
            <View style={styles.statsGrid}>
              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Total Processed</Text>
                <Text style={styles.statValue}>{summary.totalProcessed}</Text>
              </Card>

              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Matched</Text>
                <Text style={[styles.statValue, { color: '#10B981' }]}>
                  {summary.matchedCount}
                </Text>
              </Card>

              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Exceptions</Text>
                <Text style={[styles.statValue, { color: '#EF4444' }]}>
                  {summary.exceptionCount}
                </Text>
              </Card>

              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Discrepancy Volume</Text>
                <Text style={[styles.statValue, { color: '#F59E0B' }]}>
                  ${summary.totalDiscrepancyVolume.toFixed(2)}
                </Text>
              </Card>
            </View>
          </View>
        )}

        {/* Exceptions Handling */}
        {(activeTab === 'analytics' || activeTab === 'exceptions') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Exception Handling Workflow</Text>
            {exceptions.length === 0 ? (
              <Card style={styles.emptyCard}>
                <Text style={styles.emptyText}>No payment reconciliation exceptions.</Text>
              </Card>
            ) : (
              exceptions.map((ex) => (
                <Card key={ex.id} style={styles.alertCard}>
                  <View style={styles.alertHeader}>
                    <View>
                      <Text style={styles.alertTitle}>
                        {ex.status.toUpperCase()}: Sub #{ex.subscriptionId.slice(0, 8)}
                      </Text>
                      <Text style={styles.alertMessage}>
                        Variance: ${ex.discrepancyAmount.toFixed(2)} ({ex.discrepancyReason || 'Pending'})
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.ackBtn}
                      onPress={() => handleResolveException(ex.id)}>
                      <Text style={styles.ackBtnText}>Resolve</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              ))
            )}
          </View>
        )}

        {/* Reconciliation Scheduling */}
        {(activeTab === 'analytics' || activeTab === 'scheduling') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Reconciliation Scheduling & Automation</Text>
            <Card style={styles.cardSection}>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Auto-Resolve Minor Discrepancies (≤ $1.00)</Text>
                <Switch
                  value={schedule.autoResolveMinorDiscrepancies}
                  onValueChange={handleToggleAutoResolve}
                />
              </View>

              <Text style={[styles.chartTitle, { marginTop: spacing.md }]}>Automation Frequency</Text>
              <View style={styles.freqRow}>
                {(['realtime', 'hourly', 'daily', 'weekly'] as ScheduleFrequency[]).map((f) => (
                  <TouchableOpacity
                    key={f}
                    style={[
                      styles.freqBtn,
                      schedule.frequency === f && styles.freqBtnActive,
                    ]}
                    onPress={() => handleFrequencyChange(f)}>
                    <Text
                      style={[
                        styles.freqBtnText,
                        schedule.frequency === f && styles.freqBtnTextActive,
                      ]}>
                      {f.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Card>
          </View>
        )}

        {/* Reporting */}
        {(activeTab === 'analytics' || activeTab === 'reporting') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Reconciliation Reporting</Text>
            <Card style={styles.cardSection}>
              <Text style={styles.chartTitle}>Export Financial Audit Reports</Text>
              <Text style={styles.alertMessage}>
                Download standardized payment reconciliation audit logs and match reports.
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
    borderColor: '#EF4444',
    borderWidth: 1,
  },
  alertHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.textPrimary,
    flex: 0.8,
  },
  chartTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  freqRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  freqBtn: {
    flex: 0.23,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
  },
  freqBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  freqBtnText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.textSecondary,
  },
  freqBtnTextActive: {
    color: colors.surface,
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

export default PaymentReconciliationDashboard;
