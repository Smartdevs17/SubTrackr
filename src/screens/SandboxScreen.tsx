import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useSandboxStore } from '../store/sandboxStore';
import { SandboxEnvironment, SandboxStatus } from '../types/sandbox';

const SandboxScreen: React.FC = () => {
  const {
    sandboxes,
    currentSandbox,
    subscriptions,
    metrics,
    isLoading,
    error,
    fetchSandboxes,
    createSandbox,
    selectSandbox,
    deleteSandbox,
    pauseSandbox,
    resumeSandbox,
    generateTestData,
    resetSandbox,
    refreshMetrics,
    clearError,
  } = useSandboxStore();

  const [refreshing, setRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTestDataModal, setShowTestDataModal] = useState(false);
  const [sandboxName, setSandboxName] = useState('');
  const [selectedEnvironment, setSelectedEnvironment] = useState<SandboxEnvironment>(
    SandboxEnvironment.DEVELOPMENT
  );
  const [testDataCount, setTestDataCount] = useState('10');

  const developerId = 'dev_demo';

  useEffect(() => {
    fetchSandboxes(developerId);
  }, [fetchSandboxes]);

  useEffect(() => {
    if (error) {
      Alert.alert('Error', error.message, [{ text: 'OK', onPress: clearError }]);
    }
  }, [error, clearError]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchSandboxes(developerId);
    if (currentSandbox) {
      await refreshMetrics();
    }
    setRefreshing(false);
  }, [fetchSandboxes, refreshMetrics, currentSandbox]);

  const handleCreateSandbox = async () => {
    if (!sandboxName.trim()) {
      Alert.alert('Error', 'Please enter a sandbox name');
      return;
    }

    try {
      await createSandbox(developerId, sandboxName.trim(), selectedEnvironment);
      setShowCreateModal(false);
      setSandboxName('');
      Alert.alert('Success', 'Sandbox created successfully!');
    } catch {
      // Error handled by store
    }
  };

  const handleSelectSandbox = async (sandboxId: string) => {
    await selectSandbox(sandboxId);
  };

  const handleDeleteSandbox = (sandboxId: string) => {
    Alert.alert(
      'Delete Sandbox',
      'Are you sure you want to delete this sandbox? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteSandbox(sandboxId),
        },
      ]
    );
  };

  const handleToggleSandbox = async (sandboxId: string, status: SandboxStatus) => {
    if (status === SandboxStatus.ACTIVE) {
      await pauseSandbox(sandboxId);
    } else {
      await resumeSandbox(sandboxId);
    }
  };

  const handleGenerateTestData = async () => {
    const count = parseInt(testDataCount, 10);
    if (isNaN(count) || count < 1 || count > 100) {
      Alert.alert('Error', 'Please enter a number between 1 and 100');
      return;
    }

    await generateTestData({
      subscriptionCount: count,
      transactionCount: count * 5,
    });
    setShowTestDataModal(false);
    Alert.alert('Success', `Generated ${count} test subscriptions!`);
  };

  const handleResetSandbox = () => {
    Alert.alert(
      'Reset Sandbox',
      'Are you sure you want to reset this sandbox? All data will be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: resetSandbox },
      ]
    );
  };

  const getStatusColor = (status: SandboxStatus) => {
    switch (status) {
      case SandboxStatus.ACTIVE:
        return colors.success;
      case SandboxStatus.PAUSED:
        return colors.warning;
      case SandboxStatus.EXPIRED:
        return colors.error;
      case SandboxStatus.DESTROYED:
        return colors.textSecondary;
      default:
        return colors.textSecondary;
    }
  };

  const getEnvironmentLabel = (env: SandboxEnvironment) => {
    switch (env) {
      case SandboxEnvironment.DEVELOPMENT:
        return 'DEV';
      case SandboxEnvironment.STAGING:
        return 'STG';
      case SandboxEnvironment.TESTING:
        return 'TEST';
      default:
        return env.toUpperCase();
    }
  };

  const renderSandboxList = () => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Your Sandboxes</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => setShowCreateModal(true)}>
          <Text style={styles.addButtonText}>+ New</Text>
        </TouchableOpacity>
      </View>

      {sandboxes.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>No sandboxes yet</Text>
          <Text style={styles.emptyStateSubtext}>
            Create a sandbox to start testing your integration
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => setShowCreateModal(true)}>
            <Text style={styles.primaryButtonText}>Create Sandbox</Text>
          </TouchableOpacity>
        </View>
      ) : (
        sandboxes.map((sandbox) => (
          <TouchableOpacity
            key={sandbox.id}
            style={[
              styles.sandboxCard,
              currentSandbox?.id === sandbox.id && styles.sandboxCardActive,
            ]}
            onPress={() => handleSelectSandbox(sandbox.id)}>
            <View style={styles.sandboxCardHeader}>
              <View style={styles.sandboxNameContainer}>
                <Text style={styles.sandboxName}>{sandbox.name}</Text>
                <View style={styles.badgeContainer}>
                  <View style={[styles.badge, { backgroundColor: `${colors.primary}20` }]}>
                    <Text style={[styles.badgeText, { color: colors.primary }]}>
                      {getEnvironmentLabel(sandbox.environment)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: `${getStatusColor(sandbox.status)}20` },
                    ]}>
                    <Text style={[styles.badgeText, { color: getStatusColor(sandbox.status) }]}>
                      {sandbox.status}
                    </Text>
                  </View>
                </View>
              </View>
              <View style={styles.sandboxActions}>
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={() => handleToggleSandbox(sandbox.id, sandbox.status)}>
                  <Text style={styles.iconButtonText}>
                    {sandbox.status === SandboxStatus.ACTIVE ? '⏸' : '▶'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.iconButton, styles.iconButtonDanger]}
                  onPress={() => handleDeleteSandbox(sandbox.id)}>
                  <Text style={[styles.iconButtonText, styles.iconButtonTextDanger]}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.sandboxDate}>
              Created: {new Date(sandbox.createdAt).toLocaleDateString()}
            </Text>
            <Text style={styles.sandboxDate}>
              Expires: {new Date(sandbox.expiresAt).toLocaleDateString()}
            </Text>
          </TouchableOpacity>
        ))
      )}
    </View>
  );

  const renderMetrics = () => {
    if (!currentSandbox || !metrics) return null;

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Sandbox Metrics</Text>
        <View style={styles.metricsGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{metrics.totalSubscriptions}</Text>
            <Text style={styles.metricLabel}>Subscriptions</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{metrics.totalTransactions}</Text>
            <Text style={styles.metricLabel}>Transactions</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>${metrics.totalVolume.toFixed(2)}</Text>
            <Text style={styles.metricLabel}>Total Volume</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{metrics.apiCallsMade}</Text>
            <Text style={styles.metricLabel}>API Calls</Text>
          </View>
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => setShowTestDataModal(true)}>
            <Text style={styles.secondaryButtonText}>Generate Data</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.secondaryButton, styles.dangerButton]}
            onPress={handleResetSandbox}>
            <Text style={[styles.secondaryButtonText, styles.dangerButtonText]}>Reset</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderSubscriptions = () => {
    if (!currentSandbox || subscriptions.length === 0) return null;

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Test Subscriptions ({subscriptions.length})</Text>
        {subscriptions.slice(0, 5).map((sub) => (
          <View key={sub.id} style={styles.listItem}>
            <View style={styles.listItemContent}>
              <Text style={styles.listItemTitle}>{sub.name}</Text>
              <Text style={styles.listItemSubtitle}>
                ${sub.price}/{sub.billingCycle}
              </Text>
            </View>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: sub.isActive ? colors.success : colors.error },
              ]}
            />
          </View>
        ))}
        {subscriptions.length > 5 && (
          <Text style={styles.moreText}>+{subscriptions.length - 5} more subscriptions</Text>
        )}
      </View>
    );
  };

  const renderCreateModal = () => (
    <Modal
      visible={showCreateModal}
      animationType="slide"
      transparent
      onRequestClose={() => setShowCreateModal(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Create Sandbox</Text>

          <Text style={styles.inputLabel}>Sandbox Name</Text>
          <TextInput
            style={styles.input}
            value={sandboxName}
            onChangeText={setSandboxName}
            placeholder="My Sandbox"
            placeholderTextColor={colors.textSecondary}
          />

          <Text style={styles.inputLabel}>Environment</Text>
          <View style={styles.environmentSelector}>
            {Object.values(SandboxEnvironment).map((env) => (
              <TouchableOpacity
                key={env}
                style={[
                  styles.environmentOption,
                  selectedEnvironment === env && styles.environmentOptionActive,
                ]}
                onPress={() => setSelectedEnvironment(env)}>
                <Text
                  style={[
                    styles.environmentOptionText,
                    selectedEnvironment === env && styles.environmentOptionTextActive,
                  ]}>
                  {getEnvironmentLabel(env)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.modalActions}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => setShowCreateModal(false)}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={handleCreateSandbox}>
              <Text style={styles.primaryButtonText}>Create</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  const renderTestDataModal = () => (
    <Modal
      visible={showTestDataModal}
      animationType="slide"
      transparent
      onRequestClose={() => setShowTestDataModal(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Generate Test Data</Text>

          <Text style={styles.inputLabel}>Number of Subscriptions</Text>
          <TextInput
            style={styles.input}
            value={testDataCount}
            onChangeText={setTestDataCount}
            placeholder="10"
            placeholderTextColor={colors.textSecondary}
            keyboardType="numeric"
          />

          <View style={styles.modalActions}>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => setShowTestDataModal(false)}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={handleGenerateTestData}>
              <Text style={styles.primaryButtonText}>Generate</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }>
        <View style={styles.header}>
          <Text style={styles.title}>Sandbox</Text>
          <Text style={styles.subtitle}>Test your integration in an isolated environment</Text>
        </View>

        {isLoading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        ) : (
          <>
            {renderSandboxList()}
            {renderMetrics()}
            {renderSubscriptions()}
          </>
        )}
      </ScrollView>

      {renderCreateModal()}
      {renderTestDataModal()}
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
  header: {
    padding: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  section: {
    padding: spacing.lg,
    paddingTop: 0,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.md,
  },
  addButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  addButtonText: {
    ...typography.button,
    color: colors.onPrimary,
  },
  emptyState: {
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
  },
  emptyStateText: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyStateSubtext: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  sandboxCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sandboxCardActive: {
    borderColor: colors.primary,
  },
  sandboxCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  sandboxNameContainer: {
    flex: 1,
  },
  sandboxName: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  badgeContainer: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  badgeText: {
    ...typography.small,
    fontWeight: '600',
  },
  sandboxActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceVariant,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconButtonDanger: {
    backgroundColor: `${colors.error}20`,
  },
  iconButtonText: {
    ...typography.body,
    color: colors.text,
  },
  iconButtonTextDanger: {
    color: colors.error,
  },
  sandboxDate: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  metricCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    alignItems: 'center',
  },
  metricValue: {
    ...typography.h2,
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  metricLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  listItemContent: {
    flex: 1,
  },
  listItemTitle: {
    ...typography.body,
    color: colors.text,
  },
  listItemSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  moreText: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  primaryButtonText: {
    ...typography.button,
    color: colors.onPrimary,
  },
  secondaryButton: {
    backgroundColor: colors.surfaceVariant,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    flex: 1,
  },
  secondaryButtonText: {
    ...typography.button,
    color: colors.text,
  },
  dangerButton: {
    backgroundColor: `${colors.error}20`,
  },
  dangerButtonText: {
    color: colors.error,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
  },
  modalTitle: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    color: colors.text,
    ...typography.body,
    marginBottom: spacing.md,
  },
  environmentSelector: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  environmentOption: {
    flex: 1,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
  },
  environmentOptionActive: {
    backgroundColor: colors.primary,
  },
  environmentOptionText: {
    ...typography.button,
    color: colors.text,
  },
  environmentOptionTextActive: {
    color: colors.onPrimary,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  loadingContainer: {
    padding: spacing.xxl,
    alignItems: 'center',
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
});

export default SandboxScreen;
