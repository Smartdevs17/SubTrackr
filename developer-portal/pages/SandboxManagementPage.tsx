import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';

interface SandboxInstance {
  sandboxId: string;
  status: 'provisioning' | 'running' | 'stopped' | 'failed';
  createdAt: string;
  expiresAt: string;
  lastActivityAt: string;
  ttlExtended?: boolean;
  stellarAccount?: string;
  endpoints?: {
    api: string;
    horizon: string;
  };
}

interface SandboxManagementPageProps {
  onNavigate: (page: string) => void;
}

export const SandboxManagementPage: React.FC<SandboxManagementPageProps> = ({ onNavigate }) => {
  const [sandboxes, setSandboxes] = useState<SandboxInstance[]>([]);
  const [provisioning, setProvisioning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const activeCount = sandboxes.filter((s) => s.status === 'running').length;

  const loadSandboxes = useCallback(async () => {
    const instances: SandboxInstance[] = [];
    setSandboxes(instances);
  }, []);

  useEffect(() => {
    loadSandboxes();
  }, [loadSandboxes]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadSandboxes();
    setRefreshing(false);
  };

  const handleProvision = () => {
    if (activeCount >= 3) {
      Alert.alert(
        'Sandbox Limit Reached',
        'You already have 3 active sandboxes. Please wait for one to expire or tear one down before provisioning a new one.'
      );
      return;
    }

    Alert.alert(
      'Provision Sandbox',
      'This will spin up a new ephemeral sandbox instance with pre-seeded test data. ' +
        'The sandbox will auto-destroy after 1 hour (extendable to 4 hours). ' +
        'Resource limits: 512MB RAM, 1 CPU, 2GB disk.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Provision',
          onPress: async () => {
            setProvisioning(true);
            try {
              const mockSandbox: SandboxInstance = {
                sandboxId: `sbx_${Date.now().toString(36)}`,
                status: 'running',
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
                lastActivityAt: new Date().toISOString(),
                ttlExtended: false,
                stellarAccount: 'GBPLGZFOZSRG4X2LNHY7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7',
                endpoints: {
                  api: `https://sandbox-${Date.now().toString(36)}.api.subtrackr.io`,
                  horizon: 'https://horizon-testnet.stellar.org',
                },
              };
              setSandboxes((prev) => [...prev, mockSandbox]);
              Alert.alert(
                'Sandbox Provisioned',
                `Your sandbox (${mockSandbox.sandboxId}) is ready. ` +
                  'It will auto-destroy in 1 hour. Check the dashboard for details.',
                [{ text: 'OK' }]
              );
            } catch {
              Alert.alert('Error', 'Failed to provision sandbox. Please try again.');
            } finally {
              setProvisioning(false);
            }
          },
        },
      ]
    );
  };

  const handleTeardown = (sandboxId: string) => {
    Alert.alert(
      'Teardown Sandbox',
      `This will permanently destroy sandbox ${sandboxId} and all its data. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Destroy',
          style: 'destructive',
          onPress: () => {
            setSandboxes((prev) => prev.filter((s) => s.sandboxId !== sandboxId));
            Alert.alert('Destroyed', `Sandbox ${sandboxId} has been torn down.`);
          },
        },
      ]
    );
  };

  const handleExtendTtl = (sandboxId: string, sandbox: SandboxInstance) => {
    if (sandbox.ttlExtended) {
      Alert.alert(
        'Extension Limit Reached',
        'This sandbox has already been extended once. Only one 2-hour extension is allowed per sandbox (max 4 hours total).'
      );
      return;
    }

    Alert.alert(
      'Extend TTL',
      'Extend sandbox lifetime by 2 hours? (Maximum total: 4 hours, one extension allowed.)',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Extend',
          onPress: () => {
            setSandboxes((prev) =>
              prev.map((s) =>
                s.sandboxId === sandboxId
                  ? {
                      ...s,
                      expiresAt: new Date(
                        Math.min(
                          Date.now() + 4 * 3600000,
                          new Date(s.expiresAt).getTime() + 2 * 3600000
                        )
                      ).toISOString(),
                      ttlExtended: true,
                    }
                  : s
              )
            );
            Alert.alert('Extended', `Sandbox ${sandboxId} TTL extended by 2 hours.`);
          },
        },
      ]
    );
  };

  const formatTimeRemaining = (expiresAt: string): string => {
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return 'Expired';
    const mins = Math.ceil(ms / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'running':
        return '#22C55E';
      case 'provisioning':
        return '#F59E0B';
      case 'failed':
        return '#EF4444';
      default:
        return '#6B7280';
    }
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Sandbox Management</Text>
        <Text style={styles.subtitle}>
          Ephemeral sandbox instances with pre-seeded test data. Each sandbox is fully isolated via
          Docker and auto-destroys after the TTL.
        </Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{activeCount}</Text>
          <Text style={styles.statLabel}>Active</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>3</Text>
          <Text style={styles.statLabel}>Max Concurrent</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>512MB</Text>
          <Text style={styles.statLabel}>RAM Limit</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.provisionButton, provisioning && styles.provisionButtonDisabled]}
        onPress={handleProvision}
        disabled={provisioning || activeCount >= 3}
      >
        {provisioning ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={styles.provisionButtonText}>
            {activeCount >= 3 ? 'Max Sandboxes Reached' : '+ Provision Sandbox'}
          </Text>
        )}
      </TouchableOpacity>

      {sandboxes.length === 0 && !provisioning && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📦</Text>
          <Text style={styles.emptyTitle}>No Sandboxes</Text>
          <Text style={styles.emptyDesc}>
            Provision a sandbox to get started with pre-seeded test data on Stellar testnet.
          </Text>
        </View>
      )}

      {sandboxes.map((sb) => (
        <View key={sb.sandboxId} style={styles.sandboxCard}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleRow}>
              <View
                style={[styles.statusDot, { backgroundColor: getStatusColor(sb.status) }]}
              />
              <Text style={styles.sandboxId}>{sb.sandboxId}</Text>
            </View>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: getStatusColor(sb.status) + '20' },
              ]}
            >
              <Text style={[styles.statusText, { color: getStatusColor(sb.status) }]}>
                {sb.status}
              </Text>
            </View>
          </View>

          <View style={styles.cardBody}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Time Remaining</Text>
              <Text
                style={[
                  styles.infoValue,
                  { color: formatTimeRemaining(sb.expiresAt) === 'Expired' ? '#EF4444' : '#111827' },
                ]}
              >
                {formatTimeRemaining(sb.expiresAt)}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Expires At</Text>
              <Text style={styles.infoValue}>
                {new Date(sb.expiresAt).toLocaleTimeString()}
              </Text>
            </View>
            {sb.stellarAccount && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Stellar Account</Text>
                <Text style={styles.infoValue} numberOfLines={1}>
                  {sb.stellarAccount.slice(0, 12)}...
                </Text>
              </View>
            )}
            {sb.endpoints && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>API Endpoint</Text>
                <Text style={styles.infoValue} numberOfLines={1}>
                  {sb.endpoints.api}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.cardActions}>
            {sb.status === 'running' && (
              <>
                <TouchableOpacity
                  style={styles.extendButton}
                  onPress={() => handleExtendTtl(sb.sandboxId, sb)}
                >
                  <Text style={styles.extendButtonText}>Extend TTL</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.teardownButton}
                  onPress={() => handleTeardown(sb.sandboxId)}
                >
                  <Text style={styles.teardownButtonText}>Destroy</Text>
                </TouchableOpacity>
              </>
            )}
            {sb.status === 'provisioning' && (
              <ActivityIndicator size="small" color="#6366F1" />
            )}
          </View>
        </View>
      ))}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Resource Limits</Text>
        <View style={styles.limitsTable}>
          <View style={styles.limitRow}>
            <Text style={styles.limitLabel}>Memory</Text>
            <Text style={styles.limitValue}>512 MB</Text>
          </View>
          <View style={styles.limitRow}>
            <Text style={styles.limitLabel}>CPU</Text>
            <Text style={styles.limitValue}>1 core</Text>
          </View>
          <View style={styles.limitRow}>
            <Text style={styles.limitLabel}>Disk</Text>
            <Text style={styles.limitValue}>2 GB</Text>
          </View>
          <View style={styles.limitRow}>
            <Text style={styles.limitLabel}>Default TTL</Text>
            <Text style={styles.limitValue}>1 hour</Text>
          </View>
          <View style={styles.limitRow}>
            <Text style={styles.limitLabel}>Max TTL (after extension)</Text>
            <Text style={styles.limitValue}>4 hours</Text>
          </View>
          <View style={styles.limitRow}>
            <Text style={styles.limitLabel}>Max Concurrent</Text>
            <Text style={styles.limitValue}>3</Text>
          </View>
          <View style={styles.limitRow}>
            <Text style={styles.limitLabel}>Idle Timeout</Text>
            <Text style={styles.limitValue}>30 min</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Pre-seeded Test Data</Text>
        <Text style={styles.sectionDesc}>
          Each sandbox comes with realistic test data on provision:
        </Text>
        <View style={styles.seedList}>
          <View style={styles.seedItem}>
            <Text style={styles.seedIcon}>📋</Text>
            <Text style={styles.seedText}>5 sample plans</Text>
          </View>
          <View style={styles.seedItem}>
            <Text style={styles.seedIcon}>👤</Text>
            <Text style={styles.seedText}>10 mock subscribers</Text>
          </View>
          <View style={styles.seedItem}>
            <Text style={styles.seedIcon}>🧾</Text>
            <Text style={styles.seedText}>20 sample invoices</Text>
          </View>
          <View style={styles.seedItem}>
            <Text style={styles.seedIcon}>⭐</Text>
            <Text style={styles.seedText}>Stellar testnet funding via friendbot</Text>
          </View>
        </View>
      </View>

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    padding: 24,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
  },
  statsRow: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  provisionButton: {
    backgroundColor: '#6366F1',
    marginHorizontal: 16,
    marginBottom: 16,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  provisionButtonDisabled: {
    backgroundColor: '#9CA3AF',
  },
  provisionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },
  sandboxCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  sandboxId: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    fontFamily: 'monospace',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  cardBody: {
    padding: 14,
    gap: 10,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 13,
    color: '#6B7280',
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '500',
    color: '#111827',
  },
  cardActions: {
    flexDirection: 'row',
    padding: 14,
    paddingTop: 0,
    gap: 10,
  },
  extendButton: {
    flex: 1,
    backgroundColor: '#EEF2FF',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  extendButtonText: {
    color: '#6366F1',
    fontSize: 13,
    fontWeight: '600',
  },
  teardownButton: {
    flex: 1,
    backgroundColor: '#FEF2F2',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  teardownButtonText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
  },
  section: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  sectionDesc: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 12,
  },
  limitsTable: {
    gap: 0,
  },
  limitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  limitLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  limitValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
  },
  seedList: {
    gap: 10,
  },
  seedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  seedIcon: {
    fontSize: 18,
  },
  seedText: {
    fontSize: 14,
    color: '#374151',
  },
  bottomSpacer: {
    height: 40,
  },
});
