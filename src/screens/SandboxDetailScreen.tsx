import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useSandboxStore } from '../store/sandboxStore';
import { colors } from '../utils/constants';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function SandboxDetailScreen() {
  const navigation = useNavigation<NavigationProp>();
  const {
    selectedSandbox,
    sandboxSubscriptions,
    apiKeys,
    usageRecords,
    isLoading,
    generateTestData,
    toggleSandboxStatus,
    deleteSandbox,
    fetchUsageForSandbox,
  } = useSandboxStore();

  const [activeTab, setActiveTab] = useState<'overview' | 'data' | 'usage' | 'keys'>('overview');

  useEffect(() => {
    if (selectedSandbox) {
      fetchUsageForSandbox(selectedSandbox.id);
    }
  }, [selectedSandbox]);

  if (!selectedSandbox) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No sandbox selected</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const sandboxApiKeys = apiKeys.filter((k) => k.sandboxId === selectedSandbox.id);

  const handleGenerateTestData = async () => {
    await generateTestData(selectedSandbox.id);
    Alert.alert('Success', 'Test data generated successfully!');
  };

  const handleToggleStatus = async () => {
    await toggleSandboxStatus(selectedSandbox.id);
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Sandbox',
      'Are you sure you want to delete this sandbox? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteSandbox(selectedSandbox.id);
            navigation.goBack();
          },
        },
      ]
    );
  };

  const renderOverview = () => (
    <View>
      <View style={styles.infoCard}>
        <Text style={styles.cardTitle}>Environment Details</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Environment:</Text>
          <Text style={styles.infoValue}>{selectedSandbox.environment}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Status:</Text>
          <View
            style={[
              styles.statusBadge,
              selectedSandbox.isActive ? styles.statusActive : styles.statusInactive,
            ]}>
            <Text style={styles.statusText}>
              {selectedSandbox.isActive ? 'Active' : 'Inactive'}
            </Text>
          </View>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Data Isolation:</Text>
          <Text style={styles.infoValue}>
            {selectedSandbox.dataIsolation ? 'Enabled' : 'Disabled'}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Created:</Text>
          <Text style={styles.infoValue}>
            {new Date(selectedSandbox.createdAt).toLocaleDateString()}
          </Text>
        </View>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.cardTitle}>Rate Limits</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Per Minute:</Text>
          <Text style={styles.infoValue}>{selectedSandbox.rateLimit.requestsPerMinute}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Per Hour:</Text>
          <Text style={styles.infoValue}>{selectedSandbox.rateLimit.requestsPerHour}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Per Day:</Text>
          <Text style={styles.infoValue}>{selectedSandbox.rateLimit.requestsPerDay}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Burst Limit:</Text>
          <Text style={styles.infoValue}>{selectedSandbox.rateLimit.burstLimit}</Text>
        </View>
      </View>

      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{sandboxSubscriptions.length}</Text>
          <Text style={styles.statLabel}>Test Subscriptions</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{sandboxApiKeys.length}</Text>
          <Text style={styles.statLabel}>API Keys</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{usageRecords.length}</Text>
          <Text style={styles.statLabel}>API Calls</Text>
        </View>
      </View>

      <View style={styles.actionsContainer}>
        <TouchableOpacity style={styles.actionButton} onPress={handleToggleStatus}>
          <Text style={styles.actionButtonText}>
            {selectedSandbox.isActive ? 'Deactivate' : 'Activate'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionButton, styles.deleteButton]} onPress={handleDelete}>
          <Text style={styles.deleteButtonText}>Delete Sandbox</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderTestData = () => (
    <View>
      <TouchableOpacity style={styles.generateButton} onPress={handleGenerateTestData}>
        {isLoading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.generateButtonText}>Generate Test Data</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>{sandboxSubscriptions.length} Test Subscriptions</Text>

      {sandboxSubscriptions.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateIcon}>📊</Text>
          <Text style={styles.emptyStateTitle}>No Test Data</Text>
          <Text style={styles.emptyStateText}>
            Generate test subscriptions to start testing your integration
          </Text>
        </View>
      ) : (
        sandboxSubscriptions.slice(0, 20).map((sub) => (
          <View key={sub.id} style={styles.dataCard}>
            <View style={styles.dataHeader}>
              <Text style={styles.dataName}>{sub.name}</Text>
              <Text style={styles.dataPrice}>
                {sub.currency} {sub.price.toFixed(2)}
              </Text>
            </View>
            <Text style={styles.dataCategory}>{sub.category}</Text>
            <View style={styles.dataMeta}>
              <Text style={styles.dataMetaItem}>{sub.billingCycle}</Text>
              <Text style={styles.dataMetaItem}>{sub.isActive ? 'Active' : 'Inactive'}</Text>
              {sub.isCryptoEnabled && (
                <Text style={styles.dataMetaItem}>Crypto: {sub.cryptoToken}</Text>
              )}
            </View>
          </View>
        ))
      )}

      {sandboxSubscriptions.length > 20 && (
        <Text style={styles.moreItems}>
          And {sandboxSubscriptions.length - 20} more subscriptions...
        </Text>
      )}
    </View>
  );

  const renderUsage = () => (
    <View>
      {usageRecords.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateIcon}>📈</Text>
          <Text style={styles.emptyStateTitle}>No Usage Data</Text>
          <Text style={styles.emptyStateText}>Start making API calls to see usage statistics</Text>
        </View>
      ) : (
        <>
          <View style={styles.usageSummary}>
            <View style={styles.usageStat}>
              <Text style={styles.usageStatValue}>{usageRecords.length}</Text>
              <Text style={styles.usageStatLabel}>Total Requests</Text>
            </View>
            <View style={styles.usageStat}>
              <Text style={styles.usageStatValue}>
                {usageRecords.filter((r) => r.statusCode >= 200 && r.statusCode < 400).length}
              </Text>
              <Text style={styles.usageStatLabel}>Successful</Text>
            </View>
            <View style={styles.usageStat}>
              <Text style={styles.usageStatValue}>
                {usageRecords.filter((r) => r.statusCode >= 400).length}
              </Text>
              <Text style={styles.usageStatLabel}>Errors</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Recent Requests</Text>
          {usageRecords.slice(0, 10).map((record) => (
            <View key={record.id} style={styles.usageCard}>
              <View style={styles.usageHeader}>
                <Text style={styles.usageMethod}>{record.method}</Text>
                <Text style={styles.usageEndpoint}>{record.endpoint}</Text>
              </View>
              <View style={styles.usageMeta}>
                <Text
                  style={[
                    styles.usageStatus,
                    record.statusCode < 400 ? styles.statusSuccess : styles.statusError,
                  ]}>
                  {record.statusCode}
                </Text>
                <Text style={styles.usageTime}>{record.responseTime}ms</Text>
                <Text style={styles.usageTimestamp}>
                  {new Date(record.timestamp).toLocaleTimeString()}
                </Text>
              </View>
            </View>
          ))}
        </>
      )}
    </View>
  );

  const renderKeys = () => (
    <View>
      <TouchableOpacity
        style={styles.generateButton}
        onPress={() => navigation.navigate('ApiKeyManagement' as any)}>
        <Text style={styles.generateButtonText}>Manage API Keys</Text>
      </TouchableOpacity>

      {sandboxApiKeys.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateIcon}>🔑</Text>
          <Text style={styles.emptyStateTitle}>No API Keys</Text>
          <Text style={styles.emptyStateText}>
            Create an API key to start making authenticated requests
          </Text>
        </View>
      ) : (
        sandboxApiKeys.map((key) => (
          <View key={key.id} style={styles.keyCard}>
            <Text style={styles.keyName}>{key.name}</Text>
            <Text style={styles.keyDescription}>{key.description}</Text>
            <View style={styles.keyMeta}>
              <Text style={styles.keyMetaItem}>Scopes: {key.scopes.join(', ')}</Text>
              <Text style={styles.keyMetaItem}>Usage: {key.usageCount}</Text>
            </View>
          </View>
        ))
      )}
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.header}>
        <Text style={styles.title}>{selectedSandbox.name}</Text>
        <Text style={styles.subtitle}>{selectedSandbox.description}</Text>
      </View>

      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'overview' && styles.tabActive]}
          onPress={() => setActiveTab('overview')}>
          <Text style={[styles.tabText, activeTab === 'overview' && styles.tabTextActive]}>
            Overview
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'data' && styles.tabActive]}
          onPress={() => setActiveTab('data')}>
          <Text style={[styles.tabText, activeTab === 'data' && styles.tabTextActive]}>
            Test Data
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'usage' && styles.tabActive]}
          onPress={() => setActiveTab('usage')}>
          <Text style={[styles.tabText, activeTab === 'usage' && styles.tabTextActive]}>Usage</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'keys' && styles.tabActive]}
          onPress={() => setActiveTab('keys')}>
          <Text style={[styles.tabText, activeTab === 'keys' && styles.tabTextActive]}>Keys</Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'overview' && renderOverview()}
      {activeTab === 'data' && renderTestData()}
      {activeTab === 'usage' && renderUsage()}
      {activeTab === 'keys' && renderKeys()}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  emptyText: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  backButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.text,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 4,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 4,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusActive: {
    backgroundColor: '#E8F5E9',
  },
  statusInactive: {
    backgroundColor: '#FFEBEE',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.primary,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
  },
  actionsContainer: {
    gap: 12,
  },
  actionButton: {
    backgroundColor: colors.surface,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionButtonText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 16,
  },
  deleteButton: {
    borderColor: '#F44336',
  },
  deleteButtonText: {
    color: '#F44336',
    fontWeight: '600',
    fontSize: 16,
  },
  generateButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 20,
  },
  generateButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  emptyState: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 40,
    alignItems: 'center',
  },
  emptyStateIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  dataCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  dataHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  dataName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  dataPrice: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  dataCategory: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 8,
    textTransform: 'capitalize',
  },
  dataMeta: {
    flexDirection: 'row',
    gap: 12,
  },
  dataMetaItem: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  moreItems: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 12,
  },
  usageSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  usageStat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  usageStatValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.primary,
  },
  usageStatLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
  },
  usageCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  usageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  usageMethod: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
    marginRight: 8,
    textTransform: 'uppercase',
  },
  usageEndpoint: {
    fontSize: 14,
    color: colors.text,
    flex: 1,
  },
  usageMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  usageStatus: {
    fontSize: 13,
    fontWeight: '600',
  },
  statusSuccess: {
    color: '#4CAF50',
  },
  statusError: {
    color: '#F44336',
  },
  usageTime: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  usageTimestamp: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  keyCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  keyName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  keyDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  keyMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  keyMetaItem: {
    fontSize: 12,
    color: colors.textSecondary,
  },
});
