import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TextInput,
  TouchableOpacity,
  Alert,
  Switch,
  Modal,
} from 'react-native';
import { useDeveloperPortalStore } from '../../../src/store/developerPortalStore';
import { ApiKeyPermission, ApiKeyStatus } from '../../../src/types/developerPortal';
import { ApiKeyCard } from '../components/ApiKeyCard';
import { PermissionSelector } from '../components/PermissionSelector';
import { RateLimitConfig } from '../components/RateLimitConfig';

const ApiKeyManagementScreen: React.FC = () => {
  const {
    developer,
    apiKeys,
    isLoading,
    fetchApiKeys,
    createApiKey,
    revokeApiKey,
    rotateApiKey,
    deleteApiKey,
  } = useDeveloperPortalStore();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<ApiKeyPermission[]>([
    ApiKeyPermission.READ,
  ]);
  const [rateLimit, setRateLimit] = useState(100);
  const [dailyLimit, setDailyLimit] = useState(10000);
  const [neverExpires, setNeverExpires] = useState(true);
  const [expiryDays, setExpiryDays] = useState(365);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  useEffect(() => {
    if (developer) {
      fetchApiKeys(developer.id);
    }
  }, [developer]);

  const handleCreateKey = async () => {
    if (!developer || !newKeyName.trim()) {
      Alert.alert('Error', 'Please enter a name for the API key');
      return;
    }

    try {
      const expiresAt = neverExpires
        ? undefined
        : new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

      const newKey = await createApiKey(developer.id, newKeyName.trim(), selectedPermissions, {
        rateLimit,
        dailyLimit,
        expiresAt,
      });

      setCreatedKey(newKey.key);
      setNewKeyName('');
      setSelectedPermissions([ApiKeyPermission.READ]);
      setRateLimit(100);
      setDailyLimit(10000);
      setNeverExpires(true);
      setExpiryDays(365);
      setShowCreateModal(false);
    } catch (err) {
      Alert.alert('Error', 'Failed to create API key');
    }
  };

  const handleRevokeKey = (keyId: string, keyName: string) => {
    Alert.alert(
      'Revoke API Key',
      `Are you sure you want to revoke "${keyName}"? This action cannot be undone and will immediately stop all API requests using this key.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            try {
              await revokeApiKey(keyId);
              Alert.alert('Success', 'API key has been revoked');
            } catch (err) {
              Alert.alert('Error', 'Failed to revoke API key');
            }
          },
        },
      ]
    );
  };

  const handleRotateKey = (keyId: string, keyName: string) => {
    Alert.alert(
      'Rotate API Key',
      `Rotate "${keyName}"? A new key will be generated and the old key will be revoked.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rotate',
          onPress: async () => {
            try {
              await rotateApiKey(keyId);
              Alert.alert('Success', 'API key has been rotated. Copy the new key now.');
            } catch (err) {
              Alert.alert('Error', 'Failed to rotate API key');
            }
          },
        },
      ]
    );
  };

  const handleDeleteKey = (keyId: string, keyName: string) => {
    Alert.alert(
      'Delete API Key',
      `Permanently delete "${keyName}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteApiKey(keyId);
              Alert.alert('Success', 'API key has been deleted');
            } catch (err) {
              Alert.alert('Error', 'Failed to delete API key');
            }
          },
        },
      ]
    );
  };

  const activeKeys = apiKeys.filter((k) => k.status === ApiKeyStatus.ACTIVE);
  const revokedKeys = apiKeys.filter((k) => k.status === ApiKeyStatus.REVOKED);
  const expiredKeys = apiKeys.filter((k) => k.status === ApiKeyStatus.EXPIRED);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>API Key Management</Text>
            <Text style={styles.subtitle}>
              Manage your API keys and configure permissions
            </Text>
          </View>
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => setShowCreateModal(true)}>
            <Text style={styles.createButtonText}>+ New Key</Text>
          </TouchableOpacity>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{apiKeys.length}</Text>
            <Text style={styles.statLabel}>Total Keys</Text>
          </View>
          <View style={[styles.statCard, styles.statSuccess]}>
            <Text style={[styles.statValue, styles.statValueSuccess]}>{activeKeys.length}</Text>
            <Text style={styles.statLabel}>Active</Text>
          </View>
          <View style={[styles.statCard, styles.statWarning]}>
            <Text style={[styles.statValue, styles.statValueWarning]}>{revokedKeys.length}</Text>
            <Text style={styles.statLabel}>Revoked</Text>
          </View>
          <View style={[styles.statCard, styles.statError]}>
            <Text style={[styles.statValue, styles.statValueError]}>{expiredKeys.length}</Text>
            <Text style={styles.statLabel}>Expired</Text>
          </View>
        </View>

        {/* Security Warning */}
        <View style={styles.warningCard}>
          <Text style={styles.warningIcon}>⚠️</Text>
          <View style={styles.warningContent}>
            <Text style={styles.warningTitle}>Keep Your Keys Secure</Text>
            <Text style={styles.warningText}>
              Never expose API keys in client-side code, public repositories, or shared documents.
              Rotate keys regularly and revoke unused keys.
            </Text>
          </View>
        </View>

        {/* Active Keys */}
        {activeKeys.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Active Keys ({activeKeys.length})</Text>
            {activeKeys.map((key) => (
              <ApiKeyCard
                key={key.id}
                apiKey={key}
                onRevoke={() => handleRevokeKey(key.id, key.name)}
                onRotate={() => handleRotateKey(key.id, key.name)}
                onDelete={() => handleDeleteKey(key.id, key.name)}
              />
            ))}
          </View>
        )}

        {/* Revoked Keys */}
        {revokedKeys.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Revoked Keys ({revokedKeys.length})</Text>
            {revokedKeys.map((key) => (
              <ApiKeyCard
                key={key.id}
                apiKey={key}
                onDelete={() => handleDeleteKey(key.id, key.name)}
              />
            ))}
          </View>
        )}

        {/* Expired Keys */}
        {expiredKeys.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Expired Keys ({expiredKeys.length})</Text>
            {expiredKeys.map((key) => (
              <ApiKeyCard
                key={key.id}
                apiKey={key}
                onDelete={() => handleDeleteKey(key.id, key.name)}
              />
            ))}
          </View>
        )}

        {/* Empty State */}
        {apiKeys.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🔑</Text>
            <Text style={styles.emptyTitle}>No API Keys Yet</Text>
            <Text style={styles.emptyText}>
              Create your first API key to start making authenticated requests to the SubTrackr
              API
            </Text>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() => setShowCreateModal(true)}>
              <Text style={styles.emptyButtonText}>Create API Key</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Best Practices */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Best Practices</Text>
          <View style={styles.practiceCard}>
            <Text style={styles.practiceIcon}>🔒</Text>
            <View style={styles.practiceContent}>
              <Text style={styles.practiceTitle}>Use Environment Variables</Text>
              <Text style={styles.practiceText}>
                Store API keys in environment variables, never hardcode them in your source code
              </Text>
            </View>
          </View>
          <View style={styles.practiceCard}>
            <Text style={styles.practiceIcon}>🔄</Text>
            <View style={styles.practiceContent}>
              <Text style={styles.practiceTitle}>Rotate Regularly</Text>
              <Text style={styles.practiceText}>
                Rotate your API keys every 90 days or immediately after a security incident
              </Text>
            </View>
          </View>
          <View style={styles.practiceCard}>
            <Text style={styles.practiceIcon}>🎯</Text>
            <View style={styles.practiceContent}>
              <Text style={styles.practiceTitle}>Least Privilege</Text>
              <Text style={styles.practiceText}>
                Only grant the minimum permissions required for each API key
              </Text>
            </View>
          </View>
          <View style={styles.practiceCard}>
            <Text style={styles.practiceIcon}>📊</Text>
            <View style={styles.practiceContent}>
              <Text style={styles.practiceTitle}>Monitor Usage</Text>
              <Text style={styles.practiceText}>
                Regularly review API key usage and revoke keys that are no longer needed
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Create Key Modal */}
      <Modal
        visible={showCreateModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCreateModal(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowCreateModal(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Create API Key</Text>
            <TouchableOpacity onPress={handleCreateKey} disabled={!newKeyName.trim()}>
              <Text
                style={[
                  styles.modalCreate,
                  !newKeyName.trim() && styles.modalCreateDisabled,
                ]}>
                Create
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Key Name *</Text>
              <TextInput
                style={styles.formInput}
                placeholder="e.g., Production API Key"
                value={newKeyName}
                onChangeText={setNewKeyName}
                autoFocus
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Permissions</Text>
              <PermissionSelector
                selectedPermissions={selectedPermissions}
                onPermissionsChange={setSelectedPermissions}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Rate Limits</Text>
              <RateLimitConfig
                rateLimit={rateLimit}
                dailyLimit={dailyLimit}
                onRateLimitChange={setRateLimit}
                onDailyLimitChange={setDailyLimit}
              />
            </View>

            <View style={styles.formGroup}>
              <View style={styles.formRow}>
                <Text style={styles.formLabel}>Never Expires</Text>
                <Switch value={neverExpires} onValueChange={setNeverExpires} />
              </View>
              {!neverExpires && (
                <View style={styles.expiryInput}>
                  <Text style={styles.expiryLabel}>Expires in (days):</Text>
                  <TextInput
                    style={styles.expiryField}
                    value={expiryDays.toString()}
                    onChangeText={(text) => setExpiryDays(parseInt(text) || 365)}
                    keyboardType="number-pad"
                  />
                </View>
              )}
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoIcon}>ℹ️</Text>
              <Text style={styles.infoText}>
                Your API key will be shown only once after creation. Make sure to copy and store it
                securely.
              </Text>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Created Key Modal */}
      <Modal
        visible={createdKey !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setCreatedKey(null)}>
        <View style={styles.overlayContainer}>
          <View style={styles.keyRevealCard}>
            <Text style={styles.keyRevealTitle}>API Key Created Successfully</Text>
            <Text style={styles.keyRevealWarning}>
              Copy this key now. You won't be able to see it again.
            </Text>
            <View style={styles.keyRevealBox}>
              <Text style={styles.keyRevealText} selectable>
                {createdKey}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.keyRevealButton}
              onPress={() => {
                // Copy to clipboard logic here
                Alert.alert('Copied', 'API key copied to clipboard');
              }}>
              <Text style={styles.keyRevealButtonText}>Copy to Clipboard</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.keyRevealClose}
              onPress={() => setCreatedKey(null)}>
              <Text style={styles.keyRevealCloseText}>I've Saved My Key</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F7',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  createButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  createButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  statSuccess: {
    backgroundColor: '#E8F5E9',
  },
  statWarning: {
    backgroundColor: '#FFF3E0',
  },
  statError: {
    backgroundColor: '#FFEBEE',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000',
    marginBottom: 4,
  },
  statValueSuccess: {
    color: '#4CAF50',
  },
  statValueWarning: {
    color: '#FF9800',
  },
  statValueError: {
    color: '#F44336',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
  },
  warningCard: {
    backgroundColor: '#FFF3CD',
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    marginBottom: 24,
  },
  warningIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  warningContent: {
    flex: 1,
  },
  warningTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#856404',
    marginBottom: 4,
  },
  warningText: {
    fontSize: 14,
    color: '#856404',
    lineHeight: 20,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
    marginBottom: 12,
  },
  emptyState: {
    alignItems: 'center',
    padding: 48,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
  },
  emptyButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  emptyButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  practiceCard: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  practiceIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  practiceContent: {
    flex: 1,
  },
  practiceTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  practiceText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#F5F5F7',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    backgroundColor: '#FFF',
  },
  modalCancel: {
    fontSize: 16,
    color: '#007AFF',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  modalCreate: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
  },
  modalCreateDisabled: {
    color: '#CCC',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  formGroup: {
    marginBottom: 24,
  },
  formLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 8,
  },
  formInput: {
    backgroundColor: '#FFF',
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  formRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  expiryInput: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  expiryLabel: {
    fontSize: 14,
    color: '#666',
    marginRight: 12,
  },
  expiryField: {
    backgroundColor: '#FFF',
    padding: 8,
    borderRadius: 8,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    width: 80,
  },
  infoCard: {
    backgroundColor: '#E3F2FD',
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    marginTop: 24,
  },
  infoIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: '#1976D2',
    lineHeight: 20,
  },
  overlayContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  keyRevealCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  keyRevealTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
    marginBottom: 8,
    textAlign: 'center',
  },
  keyRevealWarning: {
    fontSize: 14,
    color: '#FF9800',
    marginBottom: 16,
    textAlign: 'center',
  },
  keyRevealBox: {
    backgroundColor: '#F5F5F7',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  keyRevealText: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#000',
    textAlign: 'center',
  },
  keyRevealButton: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
  },
  keyRevealButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  keyRevealClose: {
    padding: 12,
  },
  keyRevealCloseText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
  },
});

export default ApiKeyManagementScreen;
