import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TextInput,
  TouchableOpacity,
  Alert,
  Clipboard,
} from 'react-native';
import { Card } from '../components/common/Card';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useApiStore } from '../store/apiStore';
import { ApiKeyStatus } from '../types/sandbox';

const USAGE_TIERS = [
  { key: 'free', label: 'Free', desc: '100 req/min, 10K/day' },
  { key: 'basic', label: 'Basic', desc: '1K req/min, 100K/day' },
  { key: 'pro', label: 'Pro', desc: '10K req/min, 1M/day' },
  { key: 'enterprise', label: 'Enterprise', desc: '100K req/min, 10M/day' },
] as const;

const ApiKeysScreen: React.FC = () => {
  const { apiKeys, createApiKey, revokeApiKey, rotateApiKey, deleteApiKey, getKeyStats, maskKey } =
    useApiStore();

  const [newKeyName, setNewKeyName] = useState('');
  const [selectedTier, setSelectedTier] = useState<string>('free');
  const [showNewKey, setShowNewKey] = useState<string | null>(null);

  const stats = getKeyStats();

  const handleCreateKey = () => {
    if (!newKeyName.trim()) {
      Alert.alert('Name required', 'Please provide a name for the API key.');
      return;
    }

    const key = createApiKey(
      newKeyName.trim(),
      selectedTier as 'free' | 'basic' | 'pro' | 'enterprise'
    );
    setShowNewKey(key.key);
    setNewKeyName('');
    Alert.alert(
      'API Key Created',
      'Your new API key has been generated. Copy it now - it will only be shown once.'
    );
  };

  const handleCopyKey = (key: string) => {
    Clipboard.setString(key);
    Alert.alert('Copied', 'API key copied to clipboard.');
  };

  const handleRevokeKey = (keyId: string, keyName: string) => {
    Alert.alert(
      'Revoke API Key',
      `Revoke "${keyName}"? This will immediately invalidate the key.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Revoke', style: 'destructive', onPress: () => revokeApiKey(keyId) },
      ]
    );
  };

  const handleRotateKey = (keyId: string, keyName: string) => {
    Alert.alert('Rotate API Key', `Rotate "${keyName}"? The current key will be replaced.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Rotate',
        onPress: () => {
          const newKey = rotateApiKey(keyId);
          if (newKey) {
            setShowNewKey(newKey);
            Alert.alert('Key Rotated', 'Your new API key is shown below.');
          }
        },
      },
    ]);
  };

  const handleDeleteKey = (keyId: string, keyName: string) => {
    Alert.alert('Delete API Key', `Permanently delete "${keyName}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteApiKey(keyId) },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>API Keys</Text>
          <Text style={styles.subtitle}>Manage API keys with rate limiting and usage metering</Text>
        </View>

        <View style={styles.statsGrid}>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>{stats.total}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={[styles.statValue, { color: colors.success }]}>{stats.active}</Text>
            <Text style={styles.statLabel}>Active</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={[styles.statValue, { color: colors.error }]}>{stats.revoked}</Text>
            <Text style={styles.statLabel}>Revoked</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={[styles.statValue, { color: colors.warning }]}>{stats.expired}</Text>
            <Text style={styles.statLabel}>Expired</Text>
          </Card>
        </View>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Generate New Key</Text>

          <Text style={styles.label}>Key Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Production Key"
            placeholderTextColor={colors.textSecondary}
            value={newKeyName}
            onChangeText={setNewKeyName}
          />

          <Text style={styles.label}>Usage Tier</Text>
          <View style={styles.tierGrid}>
            {USAGE_TIERS.map((tier) => (
              <TouchableOpacity
                key={tier.key}
                style={[styles.tierCard, selectedTier === tier.key && styles.tierCardSelected]}
                onPress={() => setSelectedTier(tier.key)}>
                <Text
                  style={[styles.tierLabel, selectedTier === tier.key && styles.tierLabelSelected]}>
                  {tier.label}
                </Text>
                <Text style={styles.tierDesc}>{tier.desc}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.primaryButton} onPress={handleCreateKey}>
            <Text style={styles.primaryButtonText}>Generate API Key</Text>
          </TouchableOpacity>
        </Card>

        {showNewKey && (
          <Card style={[styles.section, styles.newKeyCard]}>
            <Text style={styles.newKeyTitle}>New API Key</Text>
            <Text style={styles.newKeyWarning}>
              Copy this key now. You won't be able to see it again.
            </Text>
            <View style={styles.keyDisplay}>
              <Text style={styles.keyText} selectable>
                {showNewKey}
              </Text>
            </View>
            <View style={styles.keyActions}>
              <TouchableOpacity style={styles.copyButton} onPress={() => handleCopyKey(showNewKey)}>
                <Text style={styles.copyButtonText}>Copy Key</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dismissButton} onPress={() => setShowNewKey(null)}>
                <Text style={styles.dismissButtonText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </Card>
        )}

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Your API Keys</Text>
          {apiKeys.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No API keys yet</Text>
              <Text style={styles.emptySubtext}>Generate an API key above to get started</Text>
            </View>
          ) : (
            apiKeys.map((key) => (
              <View key={key.id} style={styles.keyCard}>
                <View style={styles.keyHeader}>
                  <View style={styles.keyNameRow}>
                    <Text style={styles.keyName}>{key.name}</Text>
                    <View
                      style={[
                        styles.statusBadge,
                        {
                          backgroundColor:
                            key.status === ApiKeyStatus.ACTIVE
                              ? colors.success
                              : key.status === ApiKeyStatus.REVOKED
                                ? colors.error
                                : colors.warning,
                        },
                      ]}>
                      <Text style={styles.statusText}>{key.status}</Text>
                    </View>
                  </View>
                </View>

                <Text style={styles.keyValue}>{maskKey(key.key)}</Text>

                <View style={styles.keyMeta}>
                  <Text style={styles.keyMetaText}>
                    Rate Limit: {key.rateLimit?.requestsPerMinute ?? '-'}/min ·{' '}
                    {key.rateLimit?.requestsPerDay ?? '-'}/day
                  </Text>
                  {key.lastUsedAt && (
                    <Text style={styles.keyMetaText}>
                      Last used: {new Date(key.lastUsedAt).toLocaleDateString()}
                    </Text>
                  )}
                  <Text style={styles.keyMetaText}>
                    Created: {new Date(key.createdAt).toLocaleDateString()}
                  </Text>
                </View>

                <View style={styles.keyCardActions}>
                  {key.status === ApiKeyStatus.ACTIVE && (
                    <>
                      <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => handleCopyKey(key.key)}>
                        <Text style={styles.actionButtonText}>Copy</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => handleRotateKey(key.id, key.name)}>
                        <Text style={styles.actionButtonText}>Rotate</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionButton, styles.actionButtonDanger]}
                        onPress={() => handleRevokeKey(key.id, key.name)}>
                        <Text style={[styles.actionButtonText, { color: colors.error }]}>
                          Revoke
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleDeleteKey(key.id, key.name)}>
                    <Text style={styles.actionButtonText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </Card>
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
  statsGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    padding: spacing.md,
  },
  statValue: {
    ...typography.h2,
    color: colors.text,
    fontWeight: '800',
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
  },
  label: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  tierGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tierCard: {
    flex: 1,
    minWidth: '45%',
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
  },
  tierCardSelected: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}15`,
  },
  tierLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  tierLabelSelected: {
    color: colors.primary,
  },
  tierDesc: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryButtonText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
  },
  newKeyCard: {
    borderWidth: 2,
    borderColor: colors.success,
    backgroundColor: `${colors.success}10`,
  },
  newKeyTitle: {
    ...typography.h3,
    color: colors.success,
  },
  newKeyWarning: {
    ...typography.body,
    color: colors.warning,
    fontWeight: '600',
  },
  keyDisplay: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  keyText: {
    ...typography.caption,
    color: colors.text,
    fontFamily: 'monospace',
  },
  keyActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  copyButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    flex: 1,
    alignItems: 'center',
  },
  copyButtonText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
  },
  dismissButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    flex: 1,
    alignItems: 'center',
  },
  dismissButtonText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    ...typography.h3,
    color: colors.text,
  },
  emptySubtext: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  keyCard: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  keyHeader: {
    gap: spacing.xs,
  },
  keyNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  keyName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
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
  keyValue: {
    ...typography.caption,
    color: colors.textSecondary,
    fontFamily: 'monospace',
    marginTop: spacing.sm,
  },
  keyMeta: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  keyMetaText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  keyCardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    flexWrap: 'wrap',
  },
  actionButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  actionButtonDanger: {
    borderColor: colors.error,
  },
  actionButtonText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
  },
});

export default ApiKeysScreen;
