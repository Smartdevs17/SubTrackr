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
import { useStore } from '../store';
import { ApiKeyStatus, SandboxEnvironment } from '../types/sandbox';
import { apiKeyService } from '../services/sandbox/apiKeyService';

const ApiKeyManagementScreen: React.FC = () => {
  const { apiKeys, developerProfile, generateApiKey, revokeApiKey, deleteApiKey } =
    useStore();

  const [newKeyName, setNewKeyName] = useState('');
  const [showNewKey, setShowNewKey] = useState<string | null>(null);

  const handleGenerateKey = async () => {
    if (!newKeyName.trim()) {
      Alert.alert('Name required', 'Please provide a name for the API key.');
      return;
    }

    try {
      const key = await generateApiKey(newKeyName.trim());
      setShowNewKey(key);
      setNewKeyName('');
      Alert.alert(
        'API Key Generated',
        'Your new API key has been created. Copy it now - it will only be shown once.'
      );
    } catch {
      Alert.alert('Error', 'Failed to generate API key.');
    }
  };

  const handleCopyKey = (key: string) => {
    Clipboard.setString(key);
    Alert.alert('Copied', 'API key copied to clipboard.');
  };

  const handleRevokeKey = (keyId: string, keyName: string) => {
    Alert.alert('Revoke API Key', `Revoke "${keyName}"? This action cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: () => revokeApiKey(keyId),
      },
    ]);
  };

  const handleDeleteKey = (keyId: string, keyName: string) => {
    Alert.alert('Delete API Key', `Permanently delete "${keyName}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteApiKey(keyId),
      },
    ]);
  };

  const stats = developerProfile
    ? apiKeyService.getKeyStats(developerProfile.id)
    : { total: 0, active: 0, revoked: 0, expired: 0 };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>API Key Management</Text>
          <Text style={styles.subtitle}>
            Create and manage API keys for accessing the SubTrackr API
          </Text>
        </View>

        <View style={styles.statsGrid}>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>{stats.total}</Text>
            <Text style={styles.statLabel}>Total Keys</Text>
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
          <Text style={styles.bodyText}>
            API keys are used to authenticate requests to the SubTrackr API. Each key can be
            configured with specific permissions and rate limits.
          </Text>
          <View style={styles.formRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Key name (e.g., Production Key)"
              placeholderTextColor={colors.textSecondary}
              value={newKeyName}
              onChangeText={setNewKeyName}
            />
            <TouchableOpacity style={styles.primaryButton} onPress={handleGenerateKey}>
              <Text style={styles.primaryButtonText}>Generate</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.envHint}>
            <Text style={styles.envHintText}>
              Environment: Sandbox (Development)
            </Text>
            <Text style={styles.envHintSubtext}>
              Keys are created for the current sandbox environment
            </Text>
          </View>
        </Card>

        {showNewKey && (
          <Card style={[styles.section, styles.newKeyCard]}>
            <Text style={styles.newKeyTitle}>New API Key Created</Text>
            <Text style={styles.newKeyWarning}>
              Copy this key now. You won't be able to see it again.
            </Text>
            <View style={styles.keyDisplay}>
              <Text style={styles.keyText} selectable>
                {showNewKey}
              </Text>
            </View>
            <View style={styles.keyActions}>
              <TouchableOpacity
                style={styles.copyButton}
                onPress={() => handleCopyKey(showNewKey)}>
                <Text style={styles.copyButtonText}>Copy Key</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dismissButton}
                onPress={() => setShowNewKey(null)}>
                <Text style={styles.dismissButtonText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </Card>
        )}

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Your API Keys</Text>
          {apiKeys.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🔑</Text>
              <Text style={styles.emptyText}>No API keys yet</Text>
              <Text style={styles.emptySubtext}>
                Generate your first API key to start making API calls
              </Text>
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
                  <Text style={styles.keyEnvironment}>
                    {(key.environment ?? SandboxEnvironment.DEVELOPMENT).toUpperCase()}
                  </Text>
                </View>

                <Text style={styles.keyValue}>
                  {apiKeyService.maskApiKey(key.key)}
                </Text>

                <View style={styles.keyMeta}>
                  <Text style={styles.keyMetaText}>
                    Permissions: {(key.permissions ?? key.scopes ?? ['read']).join(', ')}
                  </Text>
                  <Text style={styles.keyMetaText}>
                    Rate: {key.rateLimit?.requestsPerMinute ?? 60}/min · {key.rateLimit?.requestsPerDay ?? 10000}/day
                  </Text>
                  {key.lastUsedAt && (
                    <Text style={styles.keyMetaText}>
                      Last used: {new Date(key.lastUsedAt).toLocaleDateString()}
                    </Text>
                  )}
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

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>API Key Best Practices</Text>
          <View style={styles.bestPractice}>
            <Text style={styles.bestPracticeTitle}>🔒 Keep keys secure</Text>
            <Text style={styles.bestPracticeText}>
              Never expose API keys in client-side code, public repositories, or shared documents.
            </Text>
          </View>
          <View style={styles.bestPractice}>
            <Text style={styles.bestPracticeTitle}>🔄 Rotate regularly</Text>
            <Text style={styles.bestPracticeText}>
              Rotate your API keys periodically and after any suspected security incident.
            </Text>
          </View>
          <View style={styles.bestPractice}>
            <Text style={styles.bestPracticeTitle}>🎯 Use least privilege</Text>
            <Text style={styles.bestPracticeText}>
              Only grant the permissions each key needs. Use read-only keys where possible.
            </Text>
          </View>
          <View style={styles.bestPractice}>
            <Text style={styles.bestPracticeTitle}>📊 Monitor usage</Text>
            <Text style={styles.bestPracticeText}>
              Review API key usage regularly and revoke unused or suspicious keys.
            </Text>
          </View>
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
  bodyText: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  formRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
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
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  primaryButtonText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
  },
  envHint: {
    padding: spacing.md,
    backgroundColor: `${colors.primary}15`,
    borderRadius: borderRadius.md,
  },
  envHintText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  envHintSubtext: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
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
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
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
  keyEnvironment: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
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
  bestPractice: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bestPracticeTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  bestPracticeText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
});

export default ApiKeyManagementScreen;
