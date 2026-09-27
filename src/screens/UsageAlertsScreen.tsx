/**
 * UsageAlertsScreen.tsx
 *
 * Displays usage alerts, overage notifications and threshold configuration
 * for monitored subscriptions.  Follows the same style pattern as
 * ChurnPredictionScreen and UsageDashboard.
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, typography, borderRadius } from '../utils/constants';
import { Card } from '../components/common/Card';
import { useThemeColors } from '../hooks/useThemeColors';
import { useUsageAlertStore } from '../store/usageAlertStore';
import { useUsageStore } from '../store/usageStore';
import { UsageThreshold, UsageAlert, OverageNotification } from '../types/usageAlerts';
import { QuotaMetric } from '../types/usage';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const METRIC_LABELS: Record<string, string> = {
  [QuotaMetric.API_CALLS]: 'API Calls',
  [QuotaMetric.STORAGE]: 'Storage',
  [QuotaMetric.SEATS]: 'Seats',
};

const generateId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function severityColor(
  severity: UsageAlert['severity'],
  colors: ReturnType<typeof useThemeColors>
): string {
  switch (severity) {
    case 'critical':
      return colors.status.error;
    case 'warning':
      return colors.status.warning;
    case 'info':
    default:
      return colors.status.success;
  }
}

function severityIcon(severity: UsageAlert['severity']): keyof typeof Ionicons.glyphMap {
  switch (severity) {
    case 'critical':
      return 'alert-circle';
    case 'warning':
      return 'warning';
    case 'info':
    default:
      return 'information-circle';
  }
}

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface AlertCardProps {
  alert: UsageAlert;
  colors: ReturnType<typeof useThemeColors>;
  styles: ReturnType<typeof createStyles>;
  onDismiss: (id: string) => void;
  onAcknowledge: (id: string) => void;
}

const AlertCard: React.FC<AlertCardProps> = ({ alert, colors, styles, onDismiss, onAcknowledge }) => {
  const sColor = severityColor(alert.severity, colors);
  const icon = severityIcon(alert.severity);
  const metricLabel = METRIC_LABELS[alert.metricName] ?? alert.metricName;
  const pct = Math.min(100, Math.round(alert.usagePercent));

  return (
    <Card style={[styles.alertCard, alert.isRead ? styles.alertCardRead : undefined]}>
      <View style={styles.alertHeader}>
        <View style={styles.alertIconTitle}>
          <Ionicons name={icon} size={20} color={sColor} style={styles.alertIcon} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.alertTitle, { color: sColor }]}>{alert.title}</Text>
            <Text style={styles.alertMetric}>{metricLabel}</Text>
          </View>
          {!alert.isRead && <View style={[styles.unreadDot, { backgroundColor: sColor }]} />}
        </View>
      </View>

      <Text style={styles.alertMessage}>{alert.message}</Text>

      {/* Usage progress bar */}
      <View style={styles.progressOuter}>
        <View
          style={[
            styles.progressInner,
            { width: `${pct}%` as any, backgroundColor: sColor },
          ]}
        />
      </View>
      <Text style={[styles.progressLabel, { color: sColor }]}>{pct}% used</Text>

      <View style={styles.alertFooter}>
        <Text style={styles.timestamp}>{formatTimestamp(alert.timestamp)}</Text>
        <View style={styles.alertActions}>
          {!alert.isRead && (
            <TouchableOpacity
              onPress={() => onAcknowledge(alert.id)}
              style={styles.alertActionBtn}
              accessibilityRole="button"
              accessibilityLabel="Mark as read">
              <Text style={[styles.alertActionText, { color: colors.brand.primary }]}>
                Mark read
              </Text>
            </TouchableOpacity>
          )}
          {!alert.isDismissed && (
            <TouchableOpacity
              onPress={() => onDismiss(alert.id)}
              style={styles.alertActionBtn}
              accessibilityRole="button"
              accessibilityLabel="Dismiss alert">
              <Text style={[styles.alertActionText, { color: colors.text.secondary }]}>
                Dismiss
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Card>
  );
};

interface OverageCardProps {
  notification: OverageNotification;
  colors: ReturnType<typeof useThemeColors>;
  styles: ReturnType<typeof createStyles>;
  onAcknowledge: (id: string) => void;
}

const OverageCard: React.FC<OverageCardProps> = ({ notification, colors, styles, onAcknowledge }) => {
  const metricLabel = METRIC_LABELS[notification.metricName] ?? notification.metricName;

  return (
    <Card style={styles.overageCard}>
      <View style={styles.alertHeader}>
        <Ionicons name="trending-up" size={20} color={colors.status.error} />
        <Text style={[styles.alertTitle, { color: colors.status.error, marginLeft: spacing.sm }]}>
          {metricLabel} Overage
        </Text>
        {!notification.isAcknowledged && (
          <View style={[styles.unreadDot, { backgroundColor: colors.status.error, marginLeft: spacing.sm }]} />
        )}
      </View>

      <View style={styles.overageRow}>
        <View style={styles.overageStat}>
          <Text style={styles.overageStatLabel}>Extra Units</Text>
          <Text style={[styles.overageStatValue, { color: colors.status.error }]}>
            {notification.overageAmount.toLocaleString()}
          </Text>
        </View>
        <View style={styles.overageStat}>
          <Text style={styles.overageStatLabel}>Est. Cost</Text>
          <Text style={[styles.overageStatValue, { color: colors.status.error }]}>
            ${notification.overageCost.toFixed(2)}
          </Text>
        </View>
      </View>

      <View style={styles.alertFooter}>
        <Text style={styles.timestamp}>{formatTimestamp(notification.timestamp)}</Text>
        {!notification.isAcknowledged && (
          <TouchableOpacity
            onPress={() => onAcknowledge(notification.id)}
            style={styles.alertActionBtn}
            accessibilityRole="button"
            accessibilityLabel="Acknowledge overage">
            <Text style={[styles.alertActionText, { color: colors.brand.primary }]}>
              Acknowledge
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </Card>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────────

const UsageAlertsScreen: React.FC = () => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const {
    alerts,
    overageNotifications,
    thresholds,
    lastChecked,
    isLoading,
    error,
    acknowledgeAlert,
    dismissAlert,
    acknowledgeOverage,
    markAllRead,
    clearAllAlerts,
    addThreshold,
    updateThreshold,
    removeThreshold,
    checkAlerts,
    clearError,
  } = useUsageAlertStore();

  const { records, subscriptionPlans, quotas } = useUsageStore();

  // Local state for add-threshold form
  const [showAddThreshold, setShowAddThreshold] = useState(false);
  const [newMetricName, setNewMetricName] = useState('ApiCalls');
  const [newWarning, setNewWarning] = useState('80');
  const [newCritical, setNewCritical] = useState('95');

  // ── Derived data ──────────────────────────────────────────────────────────

  const activeAlerts = useMemo(
    () => alerts.filter((a) => !a.isDismissed),
    [alerts]
  );
  const unreadCount = useMemo(
    () => activeAlerts.filter((a) => !a.isRead).length,
    [activeAlerts]
  );
  const criticalCount = useMemo(
    () => activeAlerts.filter((a) => a.severity === 'critical').length,
    [activeAlerts]
  );
  const pendingOverages = useMemo(
    () => overageNotifications.filter((n) => !n.isAcknowledged),
    [overageNotifications]
  );

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleRunCheck = () => {
    // Build the usage map from the current store state
    const usageMap: Record<string, { current: number; limit: number }> = {};

    for (const [subId, subRecords] of Object.entries(records)) {
      const planId = subscriptionPlans[subId];
      if (!planId) continue;
      const planQuotas = quotas[planId] ?? [];

      for (const record of subRecords) {
        const quota = planQuotas.find((q) => q.metric === record.metric);
        if (!quota) continue;
        const key = `${subId}::${record.metric}`;
        usageMap[key] = { current: record.currentUsage, limit: quota.limit };
      }
    }

    checkAlerts(usageMap);
  };

  const handleClearDismissed = () => {
    Alert.alert(
      'Clear Dismissed Alerts',
      'Remove all dismissed alerts from the list?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: clearAllAlerts,
        },
      ]
    );
  };

  const handleAddThreshold = () => {
    const warningPct = parseInt(newWarning, 10);
    const criticalPct = parseInt(newCritical, 10);

    if (isNaN(warningPct) || isNaN(criticalPct) || warningPct <= 0 || criticalPct <= 0) {
      Alert.alert('Invalid Input', 'Please enter valid percentage values.');
      return;
    }
    if (warningPct >= criticalPct) {
      Alert.alert('Invalid Input', 'Warning percentage must be less than critical percentage.');
      return;
    }

    const threshold: UsageThreshold = {
      id: generateId(),
      subscriptionId: 'global',
      metricName: newMetricName.trim() || 'ApiCalls',
      warningPercent: warningPct,
      criticalPercent: criticalPct,
      overagePercent: 100,
      enabled: true,
    };

    addThreshold(threshold);
    setShowAddThreshold(false);
    setNewMetricName('ApiCalls');
    setNewWarning('80');
    setNewCritical('95');
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Usage Alerts</Text>
          <Text style={styles.subtitle}>Monitor quota usage and overage notifications</Text>
        </View>

        {/* Error banner */}
        {error ? (
          <TouchableOpacity
            onPress={clearError}
            style={[styles.errorBanner, { backgroundColor: colors.status.error + '20' }]}
            accessibilityRole="button"
            accessibilityLabel="Dismiss error">
            <Ionicons name="alert-circle-outline" size={16} color={colors.status.error} />
            <Text style={[styles.errorText, { color: colors.status.error }]}>{error}</Text>
          </TouchableOpacity>
        ) : null}

        {/* Summary cards */}
        <View style={styles.summaryRow}>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Alerts</Text>
            <Text style={styles.summaryValue}>{activeAlerts.length}</Text>
          </Card>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Unread</Text>
            <Text style={[styles.summaryValue, unreadCount > 0 ? { color: colors.status.warning } : undefined]}>
              {unreadCount}
            </Text>
          </Card>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Critical</Text>
            <Text style={[styles.summaryValue, criticalCount > 0 ? { color: colors.status.error } : undefined]}>
              {criticalCount}
            </Text>
          </Card>
        </View>

        {/* Action buttons */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.brand.primary }]}
            onPress={handleRunCheck}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel="Run threshold check">
            <Ionicons name="refresh" size={16} color={colors.text.inverse} />
            <Text style={[styles.actionButtonText, { color: colors.text.inverse }]}>
              {isLoading ? 'Checking…' : 'Run Check'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.background.secondary }]}
            onPress={markAllRead}
            accessibilityRole="button"
            accessibilityLabel="Mark all alerts as read">
            <Ionicons name="checkmark-done" size={16} color={colors.text.primary} />
            <Text style={[styles.actionButtonText, { color: colors.text.primary }]}>
              Mark All Read
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.background.secondary }]}
            onPress={handleClearDismissed}
            accessibilityRole="button"
            accessibilityLabel="Clear dismissed alerts">
            <Ionicons name="trash-outline" size={16} color={colors.text.primary} />
            <Text style={[styles.actionButtonText, { color: colors.text.primary }]}>
              Clear Dismissed
            </Text>
          </TouchableOpacity>
        </View>

        {lastChecked ? (
          <Text style={styles.lastCheckedText}>
            Last checked: {formatTimestamp(lastChecked)}
          </Text>
        ) : null}

        {/* ── Active Alerts ── */}
        <Text style={styles.sectionTitle}>Active Alerts</Text>

        {activeAlerts.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Ionicons name="checkmark-circle-outline" size={40} color={colors.status.success} />
            <Text style={styles.emptyTitle}>All Clear</Text>
            <Text style={styles.emptySubtitle}>
              No active usage alerts. Tap "Run Check" to evaluate your current thresholds.
            </Text>
          </Card>
        ) : (
          activeAlerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              colors={colors}
              styles={styles}
              onDismiss={dismissAlert}
              onAcknowledge={acknowledgeAlert}
            />
          ))
        )}

        {/* ── Overage Notifications ── */}
        {overageNotifications.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Overage Notifications</Text>
            {pendingOverages.length === 0 ? (
              <Card style={styles.emptyCard}>
                <Text style={styles.emptySubtitle}>All overage notifications acknowledged.</Text>
              </Card>
            ) : (
              pendingOverages.map((n) => (
                <OverageCard
                  key={n.id}
                  notification={n}
                  colors={colors}
                  styles={styles}
                  onAcknowledge={acknowledgeOverage}
                />
              ))
            )}
          </>
        )}

        {/* ── Threshold Configuration ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Threshold Configuration</Text>
          <TouchableOpacity
            onPress={() => setShowAddThreshold((v) => !v)}
            style={styles.addButton}
            accessibilityRole="button"
            accessibilityLabel="Add threshold">
            <Ionicons
              name={showAddThreshold ? 'close' : 'add'}
              size={20}
              color={colors.brand.primary}
            />
          </TouchableOpacity>
        </View>

        {/* Add threshold form */}
        {showAddThreshold && (
          <Card style={styles.addForm}>
            <Text style={styles.addFormTitle}>New Threshold</Text>

            <Text style={styles.fieldLabel}>Metric Name</Text>
            <TextInput
              style={[styles.input, { color: colors.text.primary, borderColor: colors.border.default }]}
              value={newMetricName}
              onChangeText={setNewMetricName}
              placeholder="e.g. ApiCalls, Storage, Seats"
              placeholderTextColor={colors.text.secondary}
              accessibilityLabel="Metric name input"
            />

            <Text style={styles.fieldLabel}>Warning % (default 80)</Text>
            <TextInput
              style={[styles.input, { color: colors.text.primary, borderColor: colors.border.default }]}
              value={newWarning}
              onChangeText={setNewWarning}
              keyboardType="numeric"
              placeholder="80"
              placeholderTextColor={colors.text.secondary}
              accessibilityLabel="Warning percentage input"
            />

            <Text style={styles.fieldLabel}>Critical % (default 95)</Text>
            <TextInput
              style={[styles.input, { color: colors.text.primary, borderColor: colors.border.default }]}
              value={newCritical}
              onChangeText={setNewCritical}
              keyboardType="numeric"
              placeholder="95"
              placeholderTextColor={colors.text.secondary}
              accessibilityLabel="Critical percentage input"
            />

            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: colors.brand.primary }]}
              onPress={handleAddThreshold}
              accessibilityRole="button"
              accessibilityLabel="Save threshold">
              <Text style={[styles.saveButtonText, { color: colors.text.inverse }]}>
                Save Threshold
              </Text>
            </TouchableOpacity>
          </Card>
        )}

        {/* Existing thresholds */}
        {thresholds.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptySubtitle}>
              No thresholds configured. Tap + to add your first threshold.
            </Text>
          </Card>
        ) : (
          thresholds.map((threshold) => (
            <Card key={threshold.id} style={styles.thresholdCard}>
              <View style={styles.thresholdHeader}>
                <View>
                  <Text style={styles.thresholdMetric}>
                    {METRIC_LABELS[threshold.metricName] ?? threshold.metricName}
                  </Text>
                  <Text style={styles.thresholdSub}>
                    Sub: {threshold.subscriptionId === 'global' ? 'All' : threshold.subscriptionId}
                  </Text>
                </View>
                <View style={styles.thresholdBadges}>
                  <View style={[styles.badge, { backgroundColor: colors.status.warning + '30' }]}>
                    <Text style={[styles.badgeText, { color: colors.status.warning }]}>
                      ⚠ {threshold.warningPercent}%
                    </Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: colors.status.error + '30' }]}>
                    <Text style={[styles.badgeText, { color: colors.status.error }]}>
                      🚨 {threshold.criticalPercent}%
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.thresholdFooter}>
                <TouchableOpacity
                  onPress={() => updateThreshold(threshold.id, { enabled: !threshold.enabled })}
                  style={styles.thresholdToggle}
                  accessibilityRole="switch"
                  accessibilityLabel={threshold.enabled ? 'Disable threshold' : 'Enable threshold'}>
                  <Ionicons
                    name={threshold.enabled ? 'toggle' : 'toggle-outline'}
                    size={24}
                    color={threshold.enabled ? colors.brand.primary : colors.text.secondary}
                  />
                  <Text style={[styles.thresholdToggleText, { color: threshold.enabled ? colors.brand.primary : colors.text.secondary }]}>
                    {threshold.enabled ? 'Enabled' : 'Disabled'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => removeThreshold(threshold.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Remove threshold">
                  <Ionicons name="trash-outline" size={20} color={colors.status.error} />
                </TouchableOpacity>
              </View>
            </Card>
          ))
        )}

        {/* Bottom padding */}
        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background.primary },
    scrollView: { flex: 1 },
    scrollContent: { paddingBottom: spacing.xxl },

    header: { padding: spacing.lg, paddingBottom: spacing.md },
    title: { ...typography.h1, color: colors.text.primary, marginBottom: spacing.xs },
    subtitle: { ...typography.body, color: colors.text.secondary },

    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: spacing.lg,
      marginBottom: spacing.md,
      padding: spacing.sm,
      borderRadius: borderRadius.md,
      gap: spacing.sm,
    },
    errorText: { ...typography.caption, flex: 1 },

    summaryRow: {
      flexDirection: 'row',
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
      gap: spacing.md,
    },
    summaryCard: { flex: 1, alignItems: 'center' },
    summaryLabel: {
      ...typography.caption,
      color: colors.text.secondary,
      marginBottom: spacing.xs,
      textAlign: 'center',
    },
    summaryValue: { ...typography.h2, color: colors.text.primary },

    actionsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      gap: spacing.sm,
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.md,
      gap: spacing.xs,
    },
    actionButtonText: { ...typography.caption, fontWeight: '600' },

    lastCheckedText: {
      ...typography.small,
      color: colors.text.secondary,
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
    },

    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    sectionTitle: {
      ...typography.h3,
      color: colors.text.primary,
      paddingHorizontal: spacing.lg,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    addButton: {
      padding: spacing.xs,
    },

    // Alert cards
    alertCard: { marginHorizontal: spacing.lg, marginBottom: spacing.sm },
    alertCardRead: { opacity: 0.7 },
    alertHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
    alertIconTitle: { flexDirection: 'row', alignItems: 'flex-start', flex: 1 },
    alertIcon: { marginRight: spacing.sm, marginTop: 2 },
    alertTitle: { ...typography.body, fontWeight: '600' },
    alertMetric: { ...typography.small, color: colors.text.secondary },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginLeft: spacing.xs,
      marginTop: spacing.xs,
    },
    alertMessage: {
      ...typography.caption,
      color: colors.text.secondary,
      marginBottom: spacing.sm,
    },
    progressOuter: {
      height: 6,
      backgroundColor: colors.border.default,
      borderRadius: 3,
      overflow: 'hidden',
      marginBottom: spacing.xs,
    },
    progressInner: { height: '100%', borderRadius: 3 },
    progressLabel: { ...typography.small, marginBottom: spacing.sm },
    alertFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    timestamp: { ...typography.small, color: colors.text.secondary },
    alertActions: { flexDirection: 'row', gap: spacing.sm },
    alertActionBtn: { paddingHorizontal: spacing.xs },
    alertActionText: { ...typography.caption, fontWeight: '600' },

    // Overage cards
    overageCard: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
    },
    overageRow: {
      flexDirection: 'row',
      marginVertical: spacing.md,
      gap: spacing.xl,
    },
    overageStat: { alignItems: 'center' },
    overageStatLabel: { ...typography.caption, color: colors.text.secondary, marginBottom: spacing.xs },
    overageStatValue: { ...typography.h3 },

    // Empty states
    emptyCard: {
      marginHorizontal: spacing.lg,
      alignItems: 'center',
      paddingVertical: spacing.xl,
      gap: spacing.sm,
    },
    emptyTitle: { ...typography.h3, color: colors.text.primary },
    emptySubtitle: {
      ...typography.body,
      color: colors.text.secondary,
      textAlign: 'center',
    },

    // Add-threshold form
    addForm: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
    addFormTitle: { ...typography.h3, color: colors.text.primary, marginBottom: spacing.md },
    fieldLabel: { ...typography.caption, color: colors.text.secondary, marginBottom: spacing.xs },
    input: {
      borderWidth: 1,
      borderRadius: borderRadius.md,
      padding: spacing.sm,
      marginBottom: spacing.md,
      ...typography.body,
      backgroundColor: colors.background.secondary,
    },
    saveButton: {
      padding: spacing.md,
      borderRadius: borderRadius.md,
      alignItems: 'center',
    },
    saveButtonText: { ...typography.button },

    // Threshold list
    thresholdCard: { marginHorizontal: spacing.lg, marginBottom: spacing.sm },
    thresholdHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: spacing.sm,
    },
    thresholdMetric: { ...typography.body, color: colors.text.primary, fontWeight: '600' },
    thresholdSub: { ...typography.small, color: colors.text.secondary },
    thresholdBadges: { flexDirection: 'row', gap: spacing.xs },
    badge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs / 2,
      borderRadius: borderRadius.sm,
    },
    badgeText: { ...typography.small, fontWeight: '600' },
    thresholdFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    thresholdToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    thresholdToggleText: { ...typography.caption },

    bottomPad: { height: spacing.xxl },
  });
}

export default UsageAlertsScreen;
