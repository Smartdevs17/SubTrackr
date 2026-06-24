import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Card } from '../components/common/Card';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useSandboxStore } from '../store/sandboxStore';
import { SandboxEnvironment } from '../types/sandbox';
import { StatCard, EnvironmentBadge } from '../components/developer/DeveloperComponents';

const SandboxDashboardScreen: React.FC = () => {
  const {
    sandboxConfig,
    testSubscriptions,
    usageStats,
    initializeSandbox,
    switchEnvironment,
    resetTestData,
    addTestSubscription,
    removeTestSubscription,
  } = useSandboxStore();

  useEffect(() => {
    initializeSandbox();
  }, [initializeSandbox]);

  const handleResetData = () => {
    Alert.alert('Reset Test Data', 'This will reset all sandbox data. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: resetTestData },
    ]);
  };

  const handleAddTestSub = () => {
    const names = ['Test Service', 'Demo Plan', 'Sandbox Sub', 'Dev Account'];
    const name = names[Math.floor(Math.random() * names.length)];
    const price = Math.round((Math.random() * 50 + 5) * 100) / 100;
    addTestSubscription(name, price);
  };

  const handleRemoveSub = (id: string) => {
    removeTestSubscription(id);
  };

  const activeSubs = testSubscriptions.filter((s) => s.status === 'active');
  const totalMonthly = activeSubs.reduce((sum, s) => sum + s.price, 0);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Sandbox Dashboard</Text>
          <Text style={styles.subtitle}>Manage your sandbox environment and test data</Text>
        </View>

        <View style={styles.envSection}>
          <Text style={styles.sectionTitle}>Environment</Text>
          <View style={styles.envBar}>
            {[
              SandboxEnvironment.DEVELOPMENT,
              SandboxEnvironment.STAGING,
              SandboxEnvironment.PRODUCTION,
            ].map((env) => (
              <EnvironmentBadge
                key={env}
                environment={env}
                isActive={sandboxConfig.environment === env}
                onPress={() => switchEnvironment(env)}
              />
            ))}
          </View>
          <Text style={styles.envDescription}>{sandboxConfig.description}</Text>
        </View>

        <View style={styles.statsGrid}>
          <StatCard label="Test Subscriptions" value={testSubscriptions.length} />
          <StatCard label="Active" value={activeSubs.length} />
          <StatCard label="Monthly Total" value={`$${totalMonthly.toFixed(2)}`} />
          <StatCard label="API Calls" value={usageStats?.totalRequests?.toLocaleString() || '0'} />
        </View>

        <Card style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Sandbox Configuration</Text>
          </View>
          <View style={styles.configGrid}>
            <View style={styles.configItem}>
              <Text style={styles.configLabel}>Max Test Subscriptions</Text>
              <Text style={styles.configValue}>{sandboxConfig.maxTestSubscriptions ?? 50}</Text>
            </View>
            <View style={styles.configItem}>
              <Text style={styles.configLabel}>Max API Calls</Text>
              <Text style={styles.configValue}>
                {(sandboxConfig.maxApiCalls ?? 10000).toLocaleString()}
              </Text>
            </View>
            <View style={styles.configItem}>
              <Text style={styles.configLabel}>Data Reset Interval</Text>
              <Text style={styles.configValue}>{sandboxConfig.dataResetInterval ?? 'weekly'}</Text>
            </View>
            <View style={styles.configItem}>
              <Text style={styles.configLabel}>Status</Text>
              <Text
                style={[
                  styles.configValue,
                  { color: sandboxConfig.isActive ? colors.success : colors.error },
                ]}>
                {sandboxConfig.isActive ? 'Active' : 'Inactive'}
              </Text>
            </View>
          </View>
        </Card>

        <Card style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Allowed Features</Text>
            <Text style={styles.sectionMeta}>
              {(sandboxConfig.allowedFeatures ?? []).length} features
            </Text>
          </View>
          <View style={styles.featureGrid}>
            {(sandboxConfig.allowedFeatures ?? []).map((feature: string) => (
              <View key={feature} style={styles.featureChip}>
                <Text style={styles.featureChipText}>{feature.replace(/_/g, ' ')}</Text>
              </View>
            ))}
          </View>
        </Card>

        <Card style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Test Subscriptions</Text>
            <View style={styles.actionButtons}>
              <TouchableOpacity style={styles.addButton} onPress={handleAddTestSub}>
                <Text style={styles.addButtonText}>+ Add</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.resetButton} onPress={handleResetData}>
                <Text style={styles.resetButtonText}>Reset</Text>
              </TouchableOpacity>
            </View>
          </View>
          {testSubscriptions.length === 0 ? (
            <Text style={styles.emptyText}>No test subscriptions. Add some to get started.</Text>
          ) : (
            testSubscriptions.map((sub) => (
              <View key={sub.id} style={styles.subRow}>
                <View style={styles.subInfo}>
                  <Text style={styles.subName}>{sub.name}</Text>
                  <Text style={styles.subMeta}>
                    ${sub.price}/{sub.billingCycle} · {sub.currency}
                  </Text>
                </View>
                <View style={styles.subActions}>
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        backgroundColor:
                          sub.status === 'active'
                            ? colors.success
                            : sub.status === 'paused'
                              ? colors.warning
                              : colors.error,
                      },
                    ]}>
                    <Text style={styles.statusText}>{sub.status}</Text>
                  </View>
                  <TouchableOpacity onPress={() => handleRemoveSub(sub.id)}>
                    <Text style={styles.removeText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </Card>

        {usageStats && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>API Usage Summary</Text>
            <View style={styles.usageGrid}>
              <View style={styles.usageItem}>
                <Text style={styles.usageValue}>{usageStats.totalRequests}</Text>
                <Text style={styles.usageLabel}>Total Requests</Text>
              </View>
              <View style={styles.usageItem}>
                <Text style={[styles.usageValue, { color: colors.success }]}>
                  {usageStats.successfulRequests}
                </Text>
                <Text style={styles.usageLabel}>Successful</Text>
              </View>
              <View style={styles.usageItem}>
                <Text style={[styles.usageValue, { color: colors.error }]}>
                  {usageStats.failedRequests}
                </Text>
                <Text style={styles.usageLabel}>Failed</Text>
              </View>
              <View style={styles.usageItem}>
                <Text style={styles.usageValue}>{usageStats.averageResponseTime}ms</Text>
                <Text style={styles.usageLabel}>Avg Response</Text>
              </View>
            </View>

            {(usageStats.topErrors ?? []).length > 0 && (
              <>
                <Text style={styles.subsectionTitle}>Top Errors</Text>
                {(usageStats.topErrors ?? []).map(
                  (error: { code: number; count: number; message: string }) => (
                    <View key={error.code} style={styles.errorRow}>
                      <Text style={styles.errorCode}>{error.code}</Text>
                      <Text style={styles.errorMessage}>{error.message}</Text>
                      <Text style={styles.errorCount}>{error.count}x</Text>
                    </View>
                  )
                )}
              </>
            )}
          </Card>
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
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.h1,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  envSection: {
    gap: spacing.md,
  },
  envBar: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  envDescription: {
    ...typography.body,
    color: colors.textSecondary,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  section: {
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
  },
  sectionMeta: {
    ...typography.caption,
    color: colors.accent,
  },
  subsectionTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    marginTop: spacing.md,
  },
  configGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  configItem: {
    flex: 1,
    minWidth: 140,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
  },
  configLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  configValue: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  featureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  featureChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.round,
    borderWidth: 1,
    borderColor: colors.border,
  },
  featureChipText: {
    ...typography.caption,
    color: colors.text,
    textTransform: 'capitalize',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  addButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
  },
  addButtonText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
  },
  resetButton: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
  },
  resetButtonText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  subInfo: {
    flex: 1,
    gap: 2,
  },
  subName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  subMeta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  subActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.round,
  },
  statusText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  removeText: {
    ...typography.caption,
    color: colors.error,
    fontWeight: '600',
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  usageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  usageItem: {
    flex: 1,
    minWidth: 100,
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
  },
  usageValue: {
    ...typography.h2,
    color: colors.text,
    fontWeight: '800',
  },
  usageLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  errorCode: {
    ...typography.body,
    color: colors.error,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  errorMessage: {
    ...typography.body,
    color: colors.textSecondary,
    flex: 1,
  },
  errorCount: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
});

export default SandboxDashboardScreen;
