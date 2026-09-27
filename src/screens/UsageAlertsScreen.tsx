/**
 * Usage Alerts & Overage Notifications Screen (#1230)
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Card } from '../components/common/Card';
import { useThemeColors } from '../hooks/useThemeColors';
import { useUsageAlertStore } from '../store/usageAlertStore';
import { useUsageStore } from '../store/usageStore';
import { useSubscriptionStore } from '../store';
import { spacing, typography, borderRadius } from '../utils/constants';
import { QuotaMetric, QuotaStatus } from '../types/usage';
import type { OverageNotification, UsageAlert } from '../types/usageAlerts';
import { createDefaultThreshold } from '../services/usageAlertService';

// ── Constants ─────────────────────────────────────────────────────────────

const METRIC_LABELS: Record<QuotaMetric, { label: string; unit: string; icon: string }> = {
  [QuotaMetric.API_CALLS]: { label: 'API Calls', unit: 'req', icon: '🔁' },
  [QuotaMetric.STORAGE]: { label: 'Storage', unit: 'GB', icon: '💾' },
  [QuotaMetric.SEATS]: { label: 'Seats', unit: 'users', icon: '👥' },
};

// ── Severity helpers ───────────────────────────────────────────────────────

function severityIcon(s: UsageAlert['severity']): string {
  return s === 'critical' ? '🔴' : s === 'warning' ? '🟡' : '🟢';
}

// ── Sub-components ─────────────────────────────────────────────────────────

function AlertCard({
  alert,
  onDismiss,
  onRead,
  colors,
  styles,
}: {
  alert: UsageAlert;
  onDismiss: (id: string) => void;
  onRead: (id: string) => void;
  colors: ReturnType<typeof useThemeColors>;
  styles: ReturnType<typeof createStyles>;
}) {
  const barColor =
    alert.severity === 'critical'
      ? colors.status.error
      : alert.severity === 'warning'
      ? colors.status.warning
      : colors.status.success;

  return (
    <View
      style={[
        styles.alertCard,
        { borderLeftColor: barColor, opacity: alert.isDismissed ? 0.4 : 1 },
      ]}>
      <View style={styles.alertHeader}>
        <Text style={styles.alertIcon}>{severityIcon(alert.severity)}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.alertTitle}>
            {!alert.isRead && <Text style={{ color: colors.primary }}>● </Text>}
            {alert.title}
          </Text>
          <Text style={styles.alertMessage}>{alert.message}</Text>
        </View>
      </View>

      {/* Usage bar */}
      <View style={styles.usageBarBg}>
        <View
          style={[
            styles.usageBarFill,
            {
              width: `${Math.min(100, alert.usagePercent)}%` as any,
              backgroundColor: barColor,
            },
          ]}
        />
      </View>
      <Text style={styles.usagePct}>{alert.usagePercent.toFixed(1)}% used</Text>

      <View style={styles.alertFooter}>
        <Text style={styles.alertTime}>
          {new Date(alert.timestamp).toLocaleDateString()} at{' '}
          {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
        <View style={styles.alertActions}>
          {!alert.isRead && (
            <TouchableOpacity onPress={() => onRead(alert.id)} style={styles.alertBtn}>
              <Text style={[styles.alertBtnText, { color: colors.primary }]}>Mark read</Text>
            </TouchableOpacity>
          )}
          {!alert.isDismissed && (
            <TouchableOpacity onPress={() => onDismiss(alert.id)} style={styles.alertBtn}>
              <Text style={[styles.alertBtnText, { color: colors.text.secondary }]}>Dismiss</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

function OverageCard({
  notification,
  onAcknowledge,
  colors,
  styles,
}: {
  notification: OverageNotification;
  onAcknowledge: (id: string) => void;
  colors: ReturnType<typeof useThemeColors>;
  styles: ReturnType<typeof createStyles>;
}) {
  const info = METRIC_LABELS[notification.metric];
  return (
    <View style={[styles.overageCard, { opacity: notification.isAcknowledged ? 0.4 : 1 }]}>
      <View style={styles.alertHeader}>
        <Text style={styles.alertIcon}>⚠️</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.alertTitle}>
            {info.icon} {info.label} Overage
          </Text>
          <Text style={styles.alertMessage}>
            +{notification.overageAmount.toLocaleString()} {info.unit} over limit
            {notification.overageCost > 0 && ` · $${notification.overageCost.toFixed(2)} est. cost`}
          </Text>
          <Text style={styles.alertTime}>
            {new Date(notification.timestamp).toLocaleDateString()}
          </Text>
        </View>
      </View>
      {!notification.isAcknowledged && (
        <TouchableOpacity
          onPress={() => onAcknowledge(notification.id)}
          style={styles.ackBtn}>
          <Text style={[styles.alertBtnText, { color: '#fff' }]}>Acknowledge</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────

const UsageAlertsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const {
    alerts,
    overageNotifications,
    thresholds,
    lastChecked,
    isLoading,
    addThreshold,
    updateThreshold,
    markAlertRead,
    dismissAlert,
    markAllRead,
    clearDismissed,
    clearAllAlerts,
    acknowledgeOverage,
    acknowledgeAllOverages,
    checkAlerts,
    unreadCount,
    criticalCount,
  } = useUsageAlertStore();

  const { subscriptions } = useSubscriptionStore();
  const { getCurrentPeriodConsumption } = useUsageStore();

  // Seed default thresholds for active subscriptions on mount
  useEffect(() => {
    for (const sub of subscriptions.filter((s) => s.isActive)) {
      for (const metric of Object.values(QuotaMetric)) {
        addThreshold(sub.id, metric as QuotaMetric);
      }
    }
  }, [subscriptions.length]);

  const handleRunCheck = useCallback(() => {
    const usageMap: Record<string, { current: number; limit: number }> = {};
    for (const sub of subscriptions.filter((s) => s.isActive)) {
      const consumption = getCurrentPeriodConsumption(sub.id, 'free');
      for (const entry of consumption) {
        usageMap[`${sub.id}:${entry.metric}`] = {
          current: entry.current,
          limit: entry.limit,
        };
      }
    }
    checkAlerts(usageMap);
  }, [subscriptions, getCurrentPeriodConsumption, checkAlerts]);

  const visibleAlerts = useMemo(
    () => alerts.filter((a) => !a.isDismissed),
    [alerts]
  );
  const pendingOverages = useMemo(
    () => overageNotifications.filter((n) => !n.isAcknowledged),
    [overageNotifications]
  );
  const unread = unreadCount();
  const critical = criticalCount();

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Usage Alerts</Text>
          <Text style={styles.subtitle}>Monitor limits and overage notifications</Text>
        </View>

        {/* Summary KPIs */}
        <View style={styles.kpiRow}>
          <Card style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Total Alerts</Text>
            <Text style={styles.kpiValue}>{visibleAlerts.length}</Text>
          </Card>
          <Card style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Unread</Text>
            <Text style={[styles.kpiValue, { color: colors.primary }]}>{unread}</Text>
          </Card>
          <Card style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Critical</Text>
            <Text style={[styles.kpiValue, { color: colors.status.error }]}>{critical}</Text>
          </Card>
          <Card style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Overages</Text>
            <Text style={[styles.kpiValue, { color: colors.status.warning }]}>
              {pendingOverages.length}
            </Text>
          </Card>
        </View>

        {/* Action row */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.primary }]}
            onPress={handleRunCheck}>
            <Text style={styles.actionBtnText}>
              {isLoading ? 'Checking…' : '🔍 Run Check'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.background.card }]}
            onPress={markAllRead}>
            <Text style={[styles.actionBtnText, { color: colors.text.primary }]}>✓ Mark All Read</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.background.card }]}
            onPress={clearDismissed}>
            <Text style={[styles.actionBtnText, { color: colors.text.secondary }]}>🗑 Clear</Text>
          </TouchableOpacity>
        </View>

        {lastChecked && (
          <Text style={styles.lastChecked}>
            Last checked: {new Date(lastChecked).toLocaleString()}
          </Text>
        )}

        {/* Alerts list */}
        <Text style={styles.sectionTitle}>Alerts</Text>
        {visibleAlerts.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyText}>✅ No active alerts. All usage is within limits.</Text>
          </Card>
        ) : (
          visibleAlerts.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              onDismiss={dismissAlert}
              onRead={markAlertRead}
              colors={colors}
              styles={styles}
            />
          ))
        )}

        {/* Overage notifications */}
        {(overageNotifications.length > 0) && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Overage Notifications</Text>
              {pendingOverages.length > 0 && (
                <TouchableOpacity onPress={acknowledgeAllOverages}>
                  <Text style={[styles.alertBtnText, { color: colors.primary }]}>
                    Acknowledge All
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            {overageNotifications.map((n) => (
              <OverageCard
                key={n.id}
                notification={n}
                onAcknowledge={acknowledgeOverage}
                colors={colors}
                styles={styles}
              />
            ))}
          </>
        )}

        {/* Threshold configuration */}
        <Text style={styles.sectionTitle}>Alert Thresholds</Text>
        {thresholds.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              No thresholds configured. Add subscriptions to auto-generate thresholds.
            </Text>
          </Card>
        ) : (
          thresholds.map((t) => {
            const info = METRIC_LABELS[t.metric];
            return (
              <Card key={t.id} style={styles.thresholdCard}>
                <View style={styles.thresholdHeader}>
                  <Text style={styles.thresholdTitle}>
                    {info.icon} {info.label}
                  </Text>
                  <Switch
                    value={t.enabled}
                    onValueChange={(v) => updateThreshold(t.id, { enabled: v })}
                    trackColor={{ false: colors.border.default, true: colors.primary }}
                  />
                </View>
                <Text style={styles.thresholdSub}>
                  Sub: {t.subscriptionId.slice(0, 8)}…
                </Text>
                <View style={styles.thresholdRow}>
                  <View style={styles.thresholdItem}>
                    <Text style={[styles.thresholdPct, { color: colors.status.warning }]}>
                      {t.warningPercent}%
                    </Text>
                    <Text style={styles.thresholdLabel}>Warning</Text>
                  </View>
                  <View style={styles.thresholdItem}>
                    <Text style={[styles.thresholdPct, { color: colors.status.error }]}>
                      {t.criticalPercent}%
                    </Text>
                    <Text style={styles.thresholdLabel}>Critical</Text>
                  </View>
                  <View style={styles.thresholdItem}>
                    <Text style={[styles.thresholdPct, { color: colors.text.secondary }]}>
                      {t.overagePercent}%
                    </Text>
                    <Text style={styles.thresholdLabel}>Overage</Text>
                  </View>
                </View>
              </Card>
            );
          })
        )}

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background.primary },
    scroll: { paddingHorizontal: spacing.lg },
    header: { paddingTop: spacing.lg, paddingBottom: spacing.md },
    title: { ...typography.h1, color: colors.text.primary, marginBottom: spacing.xs },
    subtitle: { ...typography.body, color: colors.text.secondary },

    kpiRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    kpiCard: { flex: 1, alignItems: 'center', padding: spacing.sm },
    kpiLabel: { ...typography.small, color: colors.text.secondary, marginBottom: 2 },
    kpiValue: { ...typography.h3, color: colors.text.primary },

    actionRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
    actionBtn: {
      flex: 1,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.md,
      alignItems: 'center',
    },
    actionBtnText: { ...typography.small, color: '#fff', fontWeight: '600' },

    lastChecked: { ...typography.small, color: colors.text.secondary, marginBottom: spacing.md },

    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    sectionTitle: { ...typography.h3, color: colors.text.primary, marginBottom: spacing.sm },

    emptyCard: { marginBottom: spacing.md },
    emptyText: { ...typography.body, color: colors.text.secondary, textAlign: 'center', padding: spacing.md },

    // Alert card
    alertCard: {
      backgroundColor: colors.background.card,
      borderRadius: borderRadius.lg,
      borderLeftWidth: 4,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    alertHeader: { flexDirection: 'row', marginBottom: spacing.sm },
    alertIcon: { fontSize: 18, marginRight: spacing.sm, marginTop: 2 },
    alertTitle: { ...typography.body, color: colors.text.primary, fontWeight: '600' },
    alertMessage: { ...typography.caption, color: colors.text.secondary, marginTop: 2 },
    usageBarBg: {
      height: 6,
      backgroundColor: colors.border.default,
      borderRadius: borderRadius.full,
      overflow: 'hidden',
      marginBottom: 4,
    },
    usageBarFill: { height: '100%', borderRadius: borderRadius.full },
    usagePct: { ...typography.small, color: colors.text.secondary, marginBottom: spacing.sm },
    alertFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    alertTime: { ...typography.small, color: colors.text.secondary },
    alertActions: { flexDirection: 'row', gap: spacing.sm },
    alertBtn: { paddingHorizontal: spacing.sm },
    alertBtnText: { ...typography.small, fontWeight: '600' },

    // Overage card
    overageCard: {
      backgroundColor: colors.background.card,
      borderRadius: borderRadius.lg,
      borderLeftWidth: 4,
      borderLeftColor: colors.status.error,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    ackBtn: {
      marginTop: spacing.sm,
      backgroundColor: colors.status.error,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.md,
      alignSelf: 'flex-end',
    },

    // Threshold card
    thresholdCard: { marginBottom: spacing.sm },
    thresholdHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 4,
    },
    thresholdTitle: { ...typography.body, color: colors.text.primary, fontWeight: '600' },
    thresholdSub: { ...typography.small, color: colors.text.secondary, marginBottom: spacing.sm },
    thresholdRow: { flexDirection: 'row', gap: spacing.md },
    thresholdItem: { flex: 1, alignItems: 'center' },
    thresholdPct: { ...typography.h3 },
    thresholdLabel: { ...typography.small, color: colors.text.secondary },
  });
}

export default UsageAlertsScreen;
