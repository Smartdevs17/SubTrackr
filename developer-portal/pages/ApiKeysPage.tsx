import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
  ScrollView,
} from 'react-native';

interface ApiKey {
  id: string;
  name: string;
  key: string;
  permissions: string[];
  status: 'active' | 'revoked' | 'expired';
  lastUsedAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
}

interface ApiKeysPageProps {
  environmentId?: string;
}

const AVAILABLE_PERMISSIONS = [
  { id: 'read', label: 'Read Access', description: 'View subscriptions and data' },
  { id: 'write', label: 'Write Access', description: 'Create and update resources' },
  { id: 'delete', label: 'Delete Access', description: 'Remove resources' },
  { id: 'admin', label: 'Admin Access', description: 'Full administrative access' },
  { id: 'webhooks', label: 'Webhooks', description: 'Manage webhook configurations' },
  { id: 'analytics', label: 'Analytics', description: 'Access usage analytics' },
];

export const ApiKeysPage: React.FC<ApiKeysPageProps> = ({ environmentId }) => {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [expirationDays, setExpirationDays] = useState('90');
  const [loading, setLoading] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [generatedKey, setGeneratedKey] = useState('');

  useEffect(() => {
    loadApiKeys();
  }, []);

  const loadApiKeys = async () => {
    setApiKeys([
      {
        id: '1',
        name: 'Development Key',
        key: 'sk_test_abc123def456ghi789jkl012mno345',
        permissions: ['read', 'write'],
        status: 'active',
        lastUsedAt: new Date(Date.now() - 3600000),
        createdAt: new Date(Date.now() - 30 * 86400000),
        expiresAt: new Date(Date.now() + 60 * 86400000),
      },
      {
        id: '2',
        name: 'Staging Key',
        key: 'sk_test_pqr678stu901vwx234yza567bcd890',
        permissions: ['read', 'write', 'webhooks'],
        status: 'active',
        lastUsedAt: new Date(Date.now() - 86400000),
        createdAt: new Date(Date.now() - 15 * 86400000),
        expiresAt: new Date(Date.now() + 75 * 86400000),
      },
      {
        id: '3',
        name: 'Old Test Key',
        key: 'sk_test_efg123hij456klm789nop012qrs345',
        permissions: ['read'],
        status: 'revoked',
        lastUsedAt: new Date(Date.now() - 60 * 86400000),
        createdAt: new Date(Date.now() - 90 * 86400000),
        expiresAt: null,
      },
    ]);
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) {
      Alert.alert('Error', 'Please enter a key name');
      return;
    }

    if (selectedPermissions.length === 0) {
      Alert.alert('Error', 'Please select at least one permission');
      return;
    }

    setLoading(true);
    try {
      const newKey = `sk_test_${Math.random().toString(36).substring(2, 38)}`;
      const key: ApiKey = {
        id: Date.now().toString(),
        name: newKeyName,
        key: newKey,
        permissions: selectedPermissions,
        status: 'active',
        lastUsedAt: null,
        createdAt: new Date(),
        expiresAt: new Date(
          Date.now() + parseInt(expirationDays) * 86400000
        ),
      };

      setApiKeys((prev) => [...prev, key]);
      setModalVisible(false);
      setNewKeyName('');
      setSelectedPermissions([]);
      setGeneratedKey(newKey);
      setShowKeyModal(true);
    } catch (error) {
      Alert.alert('Error', 'Failed to create API key');
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeKey = (keyId: string, keyName: string) => {
    Alert.alert(
      'Revoke API Key',
      `Are you sure you want to revoke "${keyName}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: () => {
            setApiKeys((prev) =>
              prev.map((k) =>
                k.id === keyId ? { ...k, status: 'revoked' as const } : k
              )
            );
          },
        },
      ]
    );
  };

  const handleRotateKey = (keyId: string, keyName: string) => {
    Alert.alert(
      'Rotate API Key',
      `Are you sure you want to rotate "${keyName}"? The old key will be invalidated immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rotate',
          onPress: () => {
            const newKey = `sk_test_${Math.random().toString(36).substring(2, 38)}`;
            setApiKeys((prev) =>
              prev.map((k) =>
                k.id === keyId
                  ? { ...k, key: newKey, lastUsedAt: null }
                  : k
              )
            );
            setGeneratedKey(newKey);
            setShowKeyModal(true);
          },
        },
      ]
    );
  };

  const maskKey = (key: string): string => {
    if (key.length <= 12) return key;
    return `${key.substring(0, 12)}${'•'.repeat(20)}${key.substring(key.length - 4)}`;
  };

  const togglePermission = (permission: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(permission)
        ? prev.filter((p) => p !== permission)
        : [...prev, permission]
    );
  };

  const copyToClipboard = (text: string) => {
    Alert.alert('Copied', 'API key copied to clipboard');
  };

  const renderApiKey = ({ item }: { item: ApiKey }) => (
    <View style={styles.keyCard}>
      <View style={styles.keyHeader}>
        <View style={styles.keyInfo}>
          <Text style={styles.keyName}>{item.name}</Text>
          <TouchableOpacity onPress={() => copyToClipboard(item.key)}>
            <Text style={styles.keyValue}>{maskKey(item.key)}</Text>
          </TouchableOpacity>
        </View>
        <View
          style={[
            styles.statusBadge,
            item.status === 'active' && styles.statusActive,
            item.status === 'revoked' && styles.statusRevoked,
            item.status === 'expired' && styles.statusExpired,
          ]}
        >
          <Text style={styles.statusText}>{item.status}</Text>
        </View>
      </View>

      <View style={styles.permissionsContainer}>
        {item.permissions.map((permission) => (
          <View key={permission} style={styles.permissionBadge}>
            <Text style={styles.permissionText}>{permission}</Text>
          </View>
        ))}
      </View>

      <View style={styles.keyMeta}>
        <Text style={styles.metaText}>
          Created: {item.createdAt.toLocaleDateString()}
        </Text>
        {item.lastUsedAt && (
          <Text style={styles.metaText}>
            Last used: {item.lastUsedAt.toLocaleDateString()}
          </Text>
        )}
        {item.expiresAt && (
          <Text style={styles.metaText}>
            Expires: {item.expiresAt.toLocaleDateString()}
          </Text>
        )}
      </View>

      {item.status === 'active' && (
        <View style={styles.keyActions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.rotateButton]}
            onPress={() => handleRotateKey(item.id, item.name)}
          >
            <Text style={styles.rotateButtonText}>Rotate</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.revokeButton]}
            onPress={() => handleRevokeKey(item.id, item.name)}
          >
            <Text style={styles.revokeButtonText}>Revoke</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>API Keys</Text>
          <Text style={styles.subtitle}>
            Manage your API keys for sandbox access
          </Text>
        </View>
        <TouchableOpacity
          style={styles.createButton}
          onPress={() => setModalVisible(true)}
        >
          <Text style={styles.createButtonText}>+ Create Key</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>API Key Security</Text>
        <Text style={styles.infoText}>
          Keep your API keys secure. Never share them in public repositories or
          client-side code. Use environment variables for production keys.
        </Text>
      </View>

      <FlatList
        data={apiKeys}
        renderItem={renderApiKey}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🔑</Text>
            <Text style={styles.emptyText}>No API keys yet</Text>
            <Text style={styles.emptySubtext}>
              Create your first API key to start making requests
            </Text>
          </View>
        }
      />

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalScroll}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Create API Key</Text>

              <Text style={styles.inputLabel}>Key Name</Text>
              <TextInput
                style={styles.input}
                value={newKeyName}
                onChangeText={setNewKeyName}
                placeholder="e.g., Production Key"
                placeholderTextColor="#9CA3AF"
              />

              <Text style={styles.inputLabel}>
                Expiration (days)
              </Text>
              <TextInput
                style={styles.input}
                value={expirationDays}
                onChangeText={setExpirationDays}
                placeholder="90"
                placeholderTextColor="#9CA3AF"
                keyboardType="numeric"
              />

              <Text style={styles.inputLabel}>Permissions</Text>
              <View style={styles.permissionsList}>
                {AVAILABLE_PERMISSIONS.map((permission) => (
                  <TouchableOpacity
                    key={permission.id}
                    style={[
                      styles.permissionOption,
                      selectedPermissions.includes(permission.id) &&
                        styles.permissionOptionSelected,
                    ]}
                    onPress={() => togglePermission(permission.id)}
                  >
                    <View style={styles.permissionOptionContent}>
                      <Text
                        style={[
                          styles.permissionOptionText,
                          selectedPermissions.includes(permission.id) &&
                            styles.permissionOptionTextSelected,
                        ]}
                      >
                        {permission.label}
                      </Text>
                      <Text style={styles.permissionOptionDescription}>
                        {permission.description}
                      </Text>
                    </View>
                    {selectedPermissions.includes(permission.id) && (
                      <Text style={styles.checkmark}>✓</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={() => setModalVisible(false)}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.confirmButton]}
                  onPress={handleCreateKey}
                  disabled={loading}
                >
                  <Text style={styles.confirmButtonText}>
                    {loading ? 'Creating...' : 'Create Key'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={showKeyModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowKeyModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>API Key Created</Text>
            <Text style={styles.keyCreatedText}>
              Your API key has been created. Copy it now - you won't be able to
              see it again!
            </Text>
            <View style={styles.keyDisplay}>
              <Text style={styles.keyDisplayText} selectable>
                {generatedKey}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.modalButton, styles.confirmButton]}
              onPress={() => {
                copyToClipboard(generatedKey);
                setShowKeyModal(false);
              }}
            >
              <Text style={styles.confirmButtonText}>Copy & Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
  },
  createButton: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  infoBox: {
    backgroundColor: '#EFF6FF',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E40AF',
    marginBottom: 4,
  },
  infoText: {
    fontSize: 13,
    color: '#3B82F6',
    lineHeight: 18,
  },
  listContainer: {
    padding: 16,
  },
  keyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  keyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  keyInfo: {
    flex: 1,
  },
  keyName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  keyValue: {
    fontSize: 13,
    color: '#6B7280',
    fontFamily: 'monospace',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 12,
  },
  statusActive: {
    backgroundColor: '#D1FAE5',
  },
  statusRevoked: {
    backgroundColor: '#FEE2E2',
  },
  statusExpired: {
    backgroundColor: '#FEF3C7',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
    color: '#374151',
  },
  permissionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  permissionBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 8,
    marginBottom: 4,
  },
  permissionText: {
    fontSize: 12,
    color: '#3B82F6',
    fontWeight: '500',
  },
  keyMeta: {
    marginBottom: 12,
  },
  metaText: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 2,
  },
  keyActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 12,
  },
  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    marginLeft: 8,
  },
  rotateButton: {
    backgroundColor: '#EFF6FF',
  },
  rotateButtonText: {
    color: '#3B82F6',
    fontWeight: '600',
    fontSize: 14,
  },
  revokeButton: {
    backgroundColor: '#FEE2E2',
  },
  revokeButtonText: {
    color: '#EF4444',
    fontWeight: '600',
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: 48,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
  },
  modalScroll: {
    maxHeight: '80%',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    margin: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  permissionsList: {
    marginBottom: 24,
  },
  permissionOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  permissionOptionSelected: {
    backgroundColor: '#EFF6FF',
    borderColor: '#3B82F6',
  },
  permissionOptionContent: {
    flex: 1,
  },
  permissionOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  permissionOptionTextSelected: {
    color: '#3B82F6',
  },
  permissionOptionDescription: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  checkmark: {
    fontSize: 18,
    color: '#3B82F6',
    fontWeight: 'bold',
    marginLeft: 12,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  modalButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginLeft: 12,
  },
  cancelButton: {
    backgroundColor: '#F3F4F6',
  },
  cancelButtonText: {
    color: '#374151',
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: '#3B82F6',
  },
  confirmButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  keyCreatedText: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 16,
    lineHeight: 20,
  },
  keyDisplay: {
    backgroundColor: '#F3F4F6',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  keyDisplayText: {
    fontFamily: 'monospace',
    fontSize: 14,
    color: '#111827',
  },
});

export default ApiKeysPage;
