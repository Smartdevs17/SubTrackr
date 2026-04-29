import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
} from 'react-native';

interface ApiKey {
  id: string;
  name: string;
  key: string;
  permissions: string[];
  status: 'active' | 'revoked' | 'expired';
  lastUsedAt: Date | null;
  createdAt: Date;
}

interface ApiKeyManagerProps {
  environmentId: string;
  apiKeys: ApiKey[];
  onCreateKey: (name: string, permissions: string[]) => Promise<void>;
  onRevokeKey: (keyId: string) => Promise<void>;
  onRotateKey: (keyId: string) => Promise<void>;
}

const AVAILABLE_PERMISSIONS = [
  'subscriptions:read',
  'subscriptions:write',
  'payments:read',
  'payments:write',
  'analytics:read',
  'webhooks:manage',
];

export const ApiKeyManager: React.FC<ApiKeyManagerProps> = ({
  environmentId,
  apiKeys,
  onCreateKey,
  onRevokeKey,
  onRotateKey,
}) => {
  const [modalVisible, setModalVisible] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const handleCreateKey = useCallback(async () => {
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
      await onCreateKey(newKeyName, selectedPermissions);
      setModalVisible(false);
      setNewKeyName('');
      setSelectedPermissions([]);
      Alert.alert('Success', 'API key created successfully');
    } catch (error) {
      Alert.alert('Error', 'Failed to create API key');
    } finally {
      setLoading(false);
    }
  }, [newKeyName, selectedPermissions, onCreateKey]);

  const handleRevokeKey = useCallback(
    (keyId: string, keyName: string) => {
      Alert.alert(
        'Revoke API Key',
        `Are you sure you want to revoke "${keyName}"? This action cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Revoke',
            style: 'destructive',
            onPress: () => onRevokeKey(keyId),
          },
        ]
      );
    },
    [onRevokeKey]
  );

  const handleRotateKey = useCallback(
    (keyId: string, keyName: string) => {
      Alert.alert(
        'Rotate API Key',
        `Are you sure you want to rotate "${keyName}"? The old key will be invalidated.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Rotate',
            onPress: () => onRotateKey(keyId),
          },
        ]
      );
    },
    [onRotateKey]
  );

  const maskKey = (key: string): string => {
    if (key.length <= 12) return key;
    return `${key.substring(0, 8)}...${key.substring(key.length - 4)}`;
  };

  const togglePermission = (permission: string) => {
    setSelectedPermissions(prev =>
      prev.includes(permission)
        ? prev.filter(p => p !== permission)
        : [...prev, permission]
    );
  };

  const renderApiKey = ({ item }: { item: ApiKey }) => (
    <View style={styles.keyCard}>
      <View style={styles.keyHeader}>
        <View>
          <Text style={styles.keyName}>{item.name}</Text>
          <Text style={styles.keyValue}>{maskKey(item.key)}</Text>
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
        {item.permissions.map(permission => (
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
      </View>

      {item.status === 'active' && (
        <View style={styles.keyActions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.rotateButton]}
            onPress={() => handleRotateKey(item.id, item.name)}
          >
            <Text style={styles.actionButtonText}>Rotate</Text>
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
        <Text style={styles.title}>API Keys</Text>
        <TouchableOpacity
          style={styles.createButton}
          onPress={() => setModalVisible(true)}
        >
          <Text style={styles.createButtonText}>+ Create Key</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={apiKeys}
        renderItem={renderApiKey}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
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

            <Text style={styles.inputLabel}>Permissions</Text>
            <View style={styles.permissionsList}>
              {AVAILABLE_PERMISSIONS.map(permission => (
                <TouchableOpacity
                  key={permission}
                  style={[
                    styles.permissionOption,
                    selectedPermissions.includes(permission) &&
                      styles.permissionOptionSelected,
                  ]}
                  onPress={() => togglePermission(permission)}
                >
                  <Text
                    style={[
                      styles.permissionOptionText,
                      selectedPermissions.includes(permission) &&
                        styles.permissionOptionTextSelected,
                    ]}
                  >
                    {permission}
                  </Text>
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
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  createButton: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
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
  keyName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  keyValue: {
    fontSize: 14,
    color: '#6B7280',
    fontFamily: 'monospace',
    marginTop: 4,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
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
  actionButtonText: {
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
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    width: '90%',
    maxWidth: 400,
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
  permissionOptionText: {
    fontSize: 14,
    color: '#374151',
  },
  permissionOptionTextSelected: {
    color: '#3B82F6',
    fontWeight: '600',
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
});

export default ApiKeyManager;
