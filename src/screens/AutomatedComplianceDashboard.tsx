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
import { ComplianceService } from '../services/complianceService';
import { ComplianceAlert, ComplianceAuditTrailEntry } from '../types/compliance';

type TabType = 'dashboard' | 'monitoring' | 'alerts' | 'audit' | 'reporting';

const AutomatedComplianceDashboard: React.FC = () => {
  const { subscriptions } = useSubscriptionStore();
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [alerts, setAlerts] = useState<ComplianceAlert[]>([]);
  const [auditTrail, setAuditTrail] = useState<ComplianceAuditTrailEntry[]>([]);
  const [summary, setSummary] = useState(() => ComplianceService.getDashboardSummary());

  const handleRunChecks = () => {
    const updatedSummary = ComplianceService.runAutomatedChecks(subscriptions);
    setSummary(updatedSummary);
    setAlerts([...ComplianceService.getAlerts()]);
    setAuditTrail([...ComplianceService.getAuditTrail()]);
  };

  useEffect(() => {
    handleRunChecks();
  }, [subscriptions]);

  const handleAcknowledgeAlert = (alertId: string) => {
    ComplianceService.acknowledgeAlert(alertId);
    setAlerts([...ComplianceService.getAlerts()]);
    setSummary(ComplianceService.getDashboardSummary());
  };

  const handleExportReport = async (format: 'csv' | 'json') => {
    const reportContent = ComplianceService.generateComplianceReport(format);
    try {
      await Share.share({
        message: reportContent,
        title: `Compliance_Report.${format}`,
      });
    } catch (err) {
      console.log('Report export failed', err);
    }
  };

  const scoreColor = useMemo(() => {
    if (summary.overallComplianceScore >= 90) return '#10B981';
    if (summary.overallComplianceScore >= 70) return '#F59E0B';
    return '#EF4444';
  }, [summary.overallComplianceScore]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Automated Compliance</Text>
          <Text style={styles.subtitle}>Continuous Regulatory Monitoring & Audit Trail</Text>
        </View>

        {/* Navigation Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
          {(['dashboard', 'monitoring', 'alerts', 'audit', 'reporting'] as TabType[]).map(
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

        {/* Score & Run Button */}
        <Card style={styles.scoreCard}>
          <View style={styles.scoreHeader}>
            <View>
              <Text style={styles.scoreLabel}>Overall Compliance Score</Text>
              <Text style={[styles.scoreValue, { color: scoreColor }]}>
                {summary.overallComplianceScore}%
              </Text>
            </View>
            <TouchableOpacity style={styles.runBtn} onPress={handleRunChecks}>
              <Text style={styles.runBtnText}>Run Checks Now</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.lastRunText}>
            Last Checked: {new Date(summary.lastRunAt).toLocaleTimeString()}
          </Text>
        </Card>

        {/* Dashboard Overview */}
        {(activeTab === 'dashboard' || activeTab === 'monitoring') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Compliance Status Overview</Text>
            <View style={styles.statsGrid}>
              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Total Checks</Text>
                <Text style={styles.statValue}>{summary.totalChecksCount}</Text>
              </Card>

              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Passed</Text>
                <Text style={[styles.statValue, { color: '#10B981' }]}>
                  {summary.passedChecksCount}
                </Text>
              </Card>

              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Warnings</Text>
                <Text style={[styles.statValue, { color: '#F59E0B' }]}>
                  {summary.warningChecksCount}
                </Text>
              </Card>

              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Active Alerts</Text>
                <Text style={[styles.statValue, { color: '#EF4444' }]}>
                  {summary.activeAlertsCount}
                </Text>
              </Card>
            </View>
          </View>
        )}

        {/* Compliance Alerts */}
        {(activeTab === 'dashboard' || activeTab === 'alerts') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Compliance Alerts</Text>
            {alerts.length === 0 ? (
              <Card style={styles.emptyCard}>
                <Text style={styles.emptyText}>No active compliance alerts.</Text>
              </Card>
            ) : (
              alerts.map((alert) => (
                <Card
                  key={alert.id}
                  style={[
                    styles.alertCard,
                    alert.isAcknowledged && styles.alertAcknowledged,
                  ]}>
                  <View style={styles.alertHeader}>
                    <Text style={styles.alertTitle}>{alert.title}</Text>
                    {!alert.isAcknowledged && (
                      <TouchableOpacity
                        style={styles.ackBtn}
                        onPress={() => handleAcknowledgeAlert(alert.id)}>
                        <Text style={styles.ackBtnText}>Acknowledge</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <Text style={styles.alertMessage}>{alert.message}</Text>
                </Card>
              ))
            )}
          </View>
        )}

        {/* Audit Trail */}
        {(activeTab === 'dashboard' || activeTab === 'audit') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Compliance Audit Trail</Text>
            <Card style={styles.cardSection}>
              {auditTrail.slice(0, 8).map((entry) => (
                <View key={entry.id} style={styles.auditRow}>
                  <View style={styles.auditMain}>
                    <Text style={styles.auditAction}>{entry.action}</Text>
                    <Text style={styles.auditDetails}>{entry.details}</Text>
                  </View>
                  <Text style={styles.auditTime}>
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </Text>
                </View>
              ))}
            </Card>
          </View>
        )}

        {/* Compliance Reporting */}
        {(activeTab === 'dashboard' || activeTab === 'reporting') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Compliance Reporting</Text>
            <Card style={styles.cardSection}>
              <Text style={styles.chartTitle}>Export Regulatory Reports</Text>
              <Text style={styles.alertMessage}>
                Export comprehensive audit logs, rules status, and compliance summaries for external audits.
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
  alertAcknowledged: {
    opacity: 0.6,
    borderColor: colors.border,
  },
  alertHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  alertTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.textPrimary,
    flex: 1,
  },
  alertMessage: {
    fontSize: typography.fontSize.xs,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  ackBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  ackBtnText: {
    fontSize: 10,
    color: colors.textPrimary,
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
    marginRight: spacing.xs,
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
    fontSize: 10,
    color: colors.textSecondary,
  },
  chartTitle: {
    fontSize: typography.fontSize.md,
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

export default AutomatedComplianceDashboard;
