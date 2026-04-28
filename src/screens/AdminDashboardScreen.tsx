import React, { useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';

import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { borderRadius, colors, spacing, typography } from '../utils/constants';
import {
  AdminUserRecord,
  DashboardRole,
  MerchantRecord,
  SubscriptionAdminRecord,
  bulkUpdateSubscriptions,
  cycleSubscriptionStatus,
  deleteSubscription,
  getAdminDashboardData,
  toggleMerchantStatus,
  updateUserRole,
  upsertSubscription,
} from '../services/adminDashboardService';

const roleOptions: DashboardRole[] = ['admin', 'analyst', 'support'];

const AdminDashboardScreen: React.FC = () => {
  const { width } = useWindowDimensions();
  const isWide = width >= 1024;
  const [selectedRole, setSelectedRole] = useState<DashboardRole>('admin');
  const initialData = useMemo(() => getAdminDashboardData(selectedRole), [selectedRole]);
  const [merchants, setMerchants] = useState<MerchantRecord[]>(initialData.merchants);
  const [subscriptions, setSubscriptions] = useState<SubscriptionAdminRecord[]>(
    initialData.subscriptions
  );
  const [users, setUsers] = useState<AdminUserRecord[]>(initialData.users);
  const [selectedSubscriptions, setSelectedSubscriptions] = useState<string[]>([]);

  const analytics = initialData.analytics;
  const auditLog = initialData.auditLog;

  React.useEffect(() => {
    const nextData = getAdminDashboardData(selectedRole);
    setMerchants(nextData.merchants);
    setSubscriptions(nextData.subscriptions);
    setUsers(nextData.users);
    setSelectedSubscriptions([]);
  }, [selectedRole]);

  const toggleSelection = (id: string) => {
    setSelectedSubscriptions((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  };

  const handleBulkPause = () => {
    setSubscriptions((current) =>
      bulkUpdateSubscriptions(current, selectedSubscriptions, selectedRole)
    );
    setSelectedSubscriptions([]);
  };

  const handleCreateDraft = () => {
    setSubscriptions((current) => upsertSubscription(current, selectedRole));
  };

  const handleDeleteSubscription = (id: string) => {
    if (selectedRole !== 'admin') {
      Alert.alert('Read only', 'Only admins can delete subscriptions from the dashboard.');
      return;
    }

    setSubscriptions((current) => deleteSubscription(current, id, selectedRole));
  };

  const canManageUsers = selectedRole === 'admin';
  const canRunBulkActions = selectedRole !== 'support';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.hero, isWide && styles.heroWide]}>
          <View style={styles.heroCopy}>
            <Text style={styles.title}>Admin Dashboard</Text>
            <Text style={styles.subtitle}>
              Responsive admin controls for merchants, subscriptions, users, analytics, and audit
              history. On web this layout expands into a two-column control surface.
            </Text>
            <Text style={styles.webHint}>
              {Platform.OS === 'web'
                ? 'Web mode detected: wide layout and dense operations are enabled.'
                : 'Mobile mode detected: the same controls are stacked for smaller screens.'}
            </Text>
          </View>
          <View style={styles.roleBar}>
            {roleOptions.map((role) => (
              <TouchableOpacity
                key={role}
                style={[styles.roleChip, selectedRole === role && styles.roleChipActive]}
                onPress={() => setSelectedRole(role)}>
                <Text
                  style={[styles.roleChipText, selectedRole === role && styles.roleChipTextActive]}>
                  {role}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={[styles.metricsGrid, isWide && styles.metricsGridWide]}>
          <Card style={styles.metricCard}>
            <Text style={styles.metricValue}>{merchants.length}</Text>
            <Text style={styles.metricLabel}>Managed merchants</Text>
          </Card>
          <Card style={styles.metricCard}>
            <Text style={styles.metricValue}>{subscriptions.length}</Text>
            <Text style={styles.metricLabel}>Subscriptions in scope</Text>
          </Card>
          <Card style={styles.metricCard}>
            <Text style={styles.metricValue}>{Math.round(analytics.successRate * 100)}%</Text>
            <Text style={styles.metricLabel}>Payment success rate</Text>
          </Card>
          <Card style={styles.metricCard}>
            <Text style={styles.metricValue}>{analytics.activeAlerts.length}</Text>
            <Text style={styles.metricLabel}>Open alerts</Text>
          </Card>
        </View>

        <View style={[styles.dashboardGrid, isWide && styles.dashboardGridWide]}>
          <Card style={[styles.sectionCard, isWide && styles.sectionCardWide]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Merchant management</Text>
              <Text style={styles.sectionMeta}>Role-based controls</Text>
            </View>
            {merchants.map((merchant) => (
              <View key={merchant.id} style={styles.listRow}>
                <View style={styles.listCopy}>
                  <Text style={styles.listTitle}>{merchant.name}</Text>
                  <Text style={styles.listDescription}>
                    {merchant.activePlans} plans · ${merchant.monthlyRevenue}/mo · {merchant.status}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.inlineButton}
                  onPress={() =>
                    setMerchants((current) =>
                      current.map((entry) =>
                        entry.id === merchant.id ? toggleMerchantStatus(entry, selectedRole) : entry
                      )
                    )
                  }>
                  <Text style={styles.inlineButtonText}>
                    {merchant.status === 'active' ? 'Suspend' : 'Activate'}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </Card>

          <Card style={[styles.sectionCard, isWide && styles.sectionCardWide]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Analytics & reporting</Text>
              <Text style={styles.sectionMeta}>Monitoring-backed overview</Text>
            </View>
            <Text style={styles.analyticsText}>
              {analytics.totalTransactions} transactions processed with {analytics.failureCount}{' '}
              failures. Average gas usage: {Math.round(analytics.avgGasUsed)}.
            </Text>
            {analytics.activeAlerts.map((alert) => (
              <View key={alert.id} style={styles.alertRow}>
                <Text style={styles.alertTitle}>{alert.title}</Text>
                <Text style={styles.alertDescription}>{alert.message}</Text>
              </View>
            ))}
            {analytics.activeAlerts.length === 0 ? (
              <Text style={styles.emptyStateText}>No active alerts in the current snapshot.</Text>
            ) : null}
          </Card>

          <Card style={[styles.sectionCard, isWide && styles.sectionCardWide]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Subscription CRUD</Text>
              <Text style={styles.sectionMeta}>Create, update, delete, and bulk pause</Text>
            </View>
            <View style={styles.toolbar}>
              <Button title="Create draft" onPress={handleCreateDraft} size="small" />
              <Button
                title="Bulk pause"
                onPress={handleBulkPause}
                size="small"
                disabled={!canRunBulkActions || selectedSubscriptions.length === 0}
                variant="secondary"
              />
            </View>
            {subscriptions.map((subscription) => (
              <View key={subscription.id} style={styles.subscriptionRow}>
                <TouchableOpacity
                  style={[
                    styles.checkbox,
                    selectedSubscriptions.includes(subscription.id) && styles.checkboxActive,
                  ]}
                  onPress={() => toggleSelection(subscription.id)}>
                  <Text style={styles.checkboxText}>
                    {selectedSubscriptions.includes(subscription.id) ? 'x' : ''}
                  </Text>
                </TouchableOpacity>
                <View style={styles.listCopy}>
                  <Text style={styles.listTitle}>{subscription.name}</Text>
                  <Text style={styles.listDescription}>
                    {subscription.merchantName} · {subscription.status} · {subscription.currency}{' '}
                    {subscription.amount}
                  </Text>
                </View>
                <View style={styles.rowActions}>
                  <TouchableOpacity
                    style={styles.inlineButton}
                    onPress={() =>
                      setSubscriptions((current) =>
                        current.map((entry) =>
                          entry.id === subscription.id
                            ? cycleSubscriptionStatus(entry, selectedRole)
                            : entry
                        )
                      )
                    }>
                    <Text style={styles.inlineButtonText}>Update</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.inlineButton}
                    onPress={() => handleDeleteSubscription(subscription.id)}>
                    <Text style={styles.inlineButtonText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </Card>

          <Card style={[styles.sectionCard, isWide && styles.sectionCardWide]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>User management</Text>
              <Text style={styles.sectionMeta}>
                {canManageUsers ? 'Admin mode' : 'Read-only outside admin mode'}
              </Text>
            </View>
            {users.map((user) => (
              <View key={user.id} style={styles.listRow}>
                <View style={styles.listCopy}>
                  <Text style={styles.listTitle}>{user.name}</Text>
                  <Text style={styles.listDescription}>
                    {user.email} · role {user.role}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.inlineButton, !canManageUsers && styles.inlineButtonDisabled]}
                  onPress={() =>
                    setUsers((current) => updateUserRole(current, user.id, selectedRole))
                  }
                  disabled={!canManageUsers}>
                  <Text style={styles.inlineButtonText}>Rotate role</Text>
                </TouchableOpacity>
              </View>
            ))}
          </Card>

          <Card style={[styles.sectionCard, isWide && styles.fullWidthCard]}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Audit logging</Text>
              <Text style={styles.sectionMeta}>Latest administrative trail</Text>
            </View>
            {auditLog.map((event) => (
              <View key={event.id} style={styles.auditRow}>
                <Text style={styles.auditTitle}>{event.action}</Text>
                <Text style={styles.auditDescription}>
                  Actor {event.actorId} changed {event.resourceType} {event.resourceId}
                </Text>
                <Text style={styles.auditDescription}>{JSON.stringify(event.metadata)}</Text>
              </View>
            ))}
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  hero: {
    gap: spacing.md,
  },
  heroWide: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  heroCopy: {
    flex: 1,
    maxWidth: 760,
  },
  title: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 24,
  },
  webHint: {
    ...typography.caption,
    color: colors.accent,
    marginTop: spacing.sm,
  },
  roleBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  roleChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  roleChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  roleChipText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  roleChipTextActive: {
    color: colors.text,
  },
  metricsGrid: {
    gap: spacing.md,
  },
  metricsGridWide: {
    flexDirection: 'row',
  },
  metricCard: {
    flex: 1,
  },
  metricValue: {
    ...typography.h1,
    color: colors.text,
  },
  metricLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  dashboardGrid: {
    gap: spacing.md,
  },
  dashboardGridWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  sectionCard: {
    flexBasis: '100%',
  },
  sectionCardWide: {
    flexBasis: '48.5%',
  },
  fullWidthCard: {
    flexBasis: '100%',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
  },
  sectionMeta: {
    ...typography.caption,
    color: colors.accent,
  },
  analyticsText: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  alertRow: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
  },
  alertTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
  },
  alertDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  emptyStateText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  toolbar: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  subscriptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  listCopy: {
    flex: 1,
  },
  listTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  listDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  inlineButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inlineButtonDisabled: {
    opacity: 0.5,
  },
  inlineButtonText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  checkboxActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
  },
  rowActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  auditRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  auditTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  auditDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
});

export default AdminDashboardScreen;
