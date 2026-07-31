import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { ApiKey, ApiKeyStatus } from '../../../src/types/developerPortal';

interface ApiKeyCardProps {
  apiKey: ApiKey;
  onRevoke?: () => void;
  onRotate?: () => void;
  onDelete?: () => void;
}

export const ApiKeyCard: React.FC<ApiKeyCardProps> = ({ apiKey, onRevoke, onRotate, onDelete }) => {
  const [showFullKey, setShowFullKey] = useState(false);

  const maskKey = (key: string) => {
    if (key.length <= 12) return key;
    return `${key.substring(0, 12)}${'*'.repeat(key.length - 16)}${key.substring(key.length - 4)}`;
  };

  const getStatusColor = () => {
    switch (apiKey.status) {
      case ApiKeyStatus.ACTIVE:
        return '#4CAF50';
      case ApiKeyStatus.REVOKED:
        return '#F44336';
      case ApiKeyStatus.EXPIRED:
        return '#FF9800';
      default:
        return '#666';
    }
  };

  const formatDate = (date: string | Date | undefined) => {
    if (!date) return 'Never';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const copyToClipboard = () => {
    // Clipboard copy logic here
    Alert.alert('Copied', 'API key copied to clipboard');
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{apiKey.name}</Text>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor() }]}>
            <Text style={styles.statusText}>{apiKey.status.toUpperCase()}</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity onPress={() => setShowFullKey(!showFullKey)} style={styles.keyRow}>
        <Text style={styles.keyText} selectable={showFullKey}>
          {showFullKey ? apiKey.key : maskKey(apiKey.key)}
        </Text>
        <TouchableOpacity onPress={copyToClipboard} style={styles.copyButton}>
          <Text style={styles.copyIcon}>📋</Text>
        </TouchableOpacity>
      </TouchableOpacity>

      <View style={styles.details}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Permissions:</Text>
          <Text style={styles.detailValue}>{apiKey.permissions.join(', ')}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Rate Limit:</Text>
          <Text style={styles.detailValue}>
            {apiKey.rateLimit}/min · {apiKey.dailyLimit}/day
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Created:</Text>
          <Text style={styles.detailValue}>{formatDate(apiKey.createdAt)}</Text>
        </View>
        {apiKey.lastUsedAt && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Last Used:</Text>
            <Text style={styles.detailValue}>{formatDate(apiKey.lastUsedAt)}</Text>
          </View>
        )}
        {apiKey.expiresAt && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Expires:</Text>
            <Text style={styles.detailValue}>{formatDate(apiKey.expiresAt)}</Text>
          </View>
        )}
      </View>

      {(onRevoke || onRotate || onDelete) && (
        <View style={styles.actions}>
          {onRevoke && apiKey.status === ApiKeyStatus.ACTIVE && (
            <TouchableOpacity style={styles.actionButton} onPress={onRevoke}>
              <Text style={styles.actionText}>Revoke</Text>
            </TouchableOpacity>
          )}
          {onRotate && apiKey.status === ApiKeyStatus.ACTIVE && (
            <TouchableOpacity style={styles.actionButton} onPress={onRotate}>
              <Text style={styles.actionText}>Rotate</Text>
            </TouchableOpacity>
          )}
          {onDelete && (
            <TouchableOpacity style={[styles.actionButton, styles.deleteButton]} onPress={onDelete}>
              <Text style={[styles.actionText, styles.deleteText]}>Delete</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  header: {
    marginBottom: 12,
  },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFF',
  },
  keyRow: {
    backgroundColor: '#F5F5F7',
    padding: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  keyText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#000',
  },
  copyButton: {
    padding: 4,
  },
  copyIcon: {
    fontSize: 16,
  },
  details: {
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  detailLabel: {
    fontSize: 14,
    color: '#666',
  },
  detailValue: {
    fontSize: 14,
    color: '#000',
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  actionButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
    alignItems: 'center',
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
  },
  deleteButton: {
    borderColor: '#F44336',
  },
  deleteText: {
    color: '#F44336',
  },
});
