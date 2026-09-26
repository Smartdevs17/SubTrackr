/**
 * ApiKeysScreen
 *
 * Lightweight API-key overview screen. Supports:
 *  - Stats at a glance
 *  - Quick key creation with tier selection
 *  - Inline rotate / revoke / delete per key
 *  - Deep-link to ApiKeyManagement for full management (scopes, audit log, etc.)
 *
 * All operations are backed by the unified `useApiStore` so data is consistent
 * with the full ApiKeyManagementScreen.
 */
import React, { useState, useCallback } from 'react';
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
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../components/common/Card';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useApiStore, TIER_LABELS } from '../store/apiStore';
import { ApiKeyStatus } from '../types/sandbox';
import type { RootStackParamList } from '../navigation/types';

const TIERS = Object.entries(TIER_LABELS) as [string, { label: string; desc: string }][];

type Nav = NativeStackNavigationProp<RootStackParamList>;

const ApiKeysScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const {
    apiKeys,
    createApiKey,
    revokeApiKey,
    rotateApiKey,
    deleteApiKey,
    getKeyStats,
    maskKey,
  } = useApiStore();

  const [newKeyName, setNewKeyName]     = useState('');
  const [selectedTier, setSelectedTier] = useState('free');
  const [showNewKey, setShowNewKey]     = useState<string | null>(null);

  const stats = getKeyStats();

  const handleCreate = useCallback(() => {
    const name = newKeyName.trim();
    if (!name) {
      Alert.alert('Name required', 'Please provide a name for the API key.');
      return;
    }
    const created = createApiKey(
      name,
      selectedTier as 'free' | 'basic' | 'pro' | 'enterprise'
    );
    setShowNewKey(created.key);
    setNewKeyName('');
  }, [newKeyName, selectedTier, createApiKey]);

  const handleCopy = useCallback((key: string) => {
    Clipboard.setString(key);
    Alert.alert('Copied', 'API key copied to clipboard.');
  }, []);

  const handleRotate = useCallback((keyId: string, keyName: string) => {
    Alert.alert(
      'Rotate Key',
      `Rotating "${keyName}" will immediately invalidate the current secret. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rotate',
          onPress: () => {
            const newRaw = rotateApiKey(keyId);
            if (newRaw) {
              setShowNewKey(newRaw);
            } else {
              Alert.alert('Error', 'Could not rotate key. It may no longer be active.');
            }
          },
        },
      ]
    );
  }, [rotateApiKey]);

  const handleRevoke = useCallback((keyId: string, keyName: string) => {
    Alert.alert(
      'Revoke Key',
      `Revoking "${keyName}" will immediately invalidate it. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Revoke', style: 'destructive', onPress: () => revokeApiKey(keyId) },
      ]
    );
  }, [revokeApiKey]);

  const handleDelete = useCallback((keyId: string, keyName: string) => {
    Alert.alert('Delete Key', `Permanently delete "${keyName}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteApiKey(keyId) },
    ]);
  }, [deleteApiKey]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>

        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>API Keys</Text>
            <Text style={styles.subtitle}>Quick overview and key management</Text>
          </View>
          <TouchableOpacity
            style={styles.manageBtn}
            onPress={() => navigation.navigate('ApiKeyManagement')}
            accessibilityLabel="Open full API key management"
            accessibilityRole="button">
            <Text style={styles.manageBtnText}>Full Management →</Text>
          </TouchableOpacity>
        </View>

        {/* Stats */}
        <View style={styles.statsGrid}>
          {[
            { label: 'Total',   value: stats.total,   color: colors.text },
            { label: 'Active',  value: stats.active,  color: colors.success },
            { label: 'Revoked', value: stats.revoked, color: colors.error },
            { label: 'Expired', value: stats.expired, color: colors.warning },
          ].map(({ label, value, color }) => (
            <Card key={label} style={styles.statCard}>
              <Text style={[styles.statValue, { color }]}>{value}</Text>
              <Text style={styles.statLabel}>{label}</Text>
            </Card>
          ))}
        </View>

        {/* New key revealed banner */}
        {showNewKey && (
          <Card style={styles.newKeyCard}>
            <Text style={styles.newKeyTitle}>New API Key</Text>
            <Text style={styles.newKeyWarning}>Copy now — shown once only.</Text>
            <View style={styles.keyDisplayBox}>
              <Text style={styles.keyMonoText} selectable>{showNewKey}</Text>
            </View>
            <View style={styles.rowButtons}>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, { flex: 1 }]}
                onPress={() => handleCopy(showNewKey)}
                accessibilityLabel="Copy API key"
                accessibilityRole="button">
                <Text style={styles.btnPrimaryText}>Copy Key</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnOutline, { flex: 1 }]}
                onPress={() => setShowNewKey(null)}
                accessibilityLabel="Dismiss"
                accessibilityRole="button">
                <Text style={styles.btnOutlineText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </Card>
        )}

        {/* Quick create form */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Generate New Key</Text>

          <Text style={styles.fieldLabel}>Key Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Production Key"
            placeholderTextColor={colors.textSecondary}
            value={newKeyName}
            onChangeText={setNewKeyName}
            accessibilityLabel="API key name"
          />

          <Text style={styles.fieldLabel}>Usage Tier</Text>
          <View style={styles.tierGrid}>
            {TIERS.map(([tierKey, info]) => (
              <TouchableOpacity
                key={tierKey}
                style={[styles.tierCard, selectedTier === tierKey && styles.tierCardSelected]}
                onPress={() => setSelectedTier(tierKey)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selectedTier === tierKey }}
                accessibilityLabel={`Select ${info.label} tier`}>
                <Text style={[styles.tierLabel, selectedTier === tierKey && styles.tierLabelSelected]}>
                  {info.label}
                </Text>
                <Text style={styles.tierDesc}>{info.desc}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={handleCreate}
            accessibilityLabel="Generate API key"
            accessibilityRole="button">
            <Text style={styles.btnPrimaryText}>Generate API Key</Text>
          </TouchableOpacity>
        </Card>

        {/* Keys list */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Your API Keys</Text>

          {apiKeys.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No API keys yet</Text>
              <Text style={styles.emptySubtext}>Generate a key above to get started</Text>
            </View>
          ) : (
            apiKeys.map((key) => (
              <View key={key.id} style={styles.keyCard}>
                <View style={styles.keyCardTop}>
                  <Text style={styles.keyName} numberOfLines={1}>{key.name}</Text>
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
                    <Text style={styles.statusText}>{key.status.toUpperCase()}</Text>
                  </View>
                </View>

                <Text style={styles.keyMasked}>{maskKey(key.key)}</Text>

                <View style={styles.keyMeta}>
                  <Text style={styles.keyMetaText}>
                    Rate: {key.rateLimit?.requestsPerMinute ?? '—'}/min ·{' '}
                    {key.rateLimit?.requestsPerDay ?? '—'}/day
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

                <View style={styles.keyActions}>
                  {key.status === ApiKeyStatus.ACTIVE && (
                    <>
                      <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={() => handleRotate(key.id, key.name)}
                        accessibilityLabel={`Rotate ${key.name}`}
                        accessibilityRole="button">
                        <Text style={styles.actionBtnText}>🔄 Rotate</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionBtn, { borderColor: colors.error }]}
                        onPress={() => handleRevoke(key.id, key.name)}
                        accessibilityLabel={`Revoke ${key.name}`}
                        accessibilityRole="button">
                        <Text style={[styles.actionBtnText, { color: colors.error }]}>
                          🚫 Revoke
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => handleDelete(key.id, key.name)}
                    accessibilityLabel={`Delete ${key.name}`}
                    accessibilityRole="button">
                    <Text style={styles.actionBtnText}>🗑 Delete</Text>
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

// ─── styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },

  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
  manageBtn: {
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  manageBtnText: { ...typography.caption, color: colors.primary, fontWeight: '700' },

  statsGrid: { flexDirection: 'row', gap: spacing.sm },
  statCard: { flex: 1, alignItems: 'center', padding: spacing.md },
  statValue: { ...typography.h2, fontWeight: '800' },
  statLabel: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },

  section: { gap: spacing.md },
  sectionTitle: { ...typography.h3, color: colors.text },
  fieldLabel: { ...typography.body, color: colors.textSecondary, fontWeight: '600' },

  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    backgroundColor: colors.surface,
    ...typography.body,
  },

  tierGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tierCard: {
    flex: 1,
    minWidth: '45%',
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
  },
  tierCardSelected: { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  tierLabel: { ...typography.body, color: colors.text, fontWeight: '700' },
  tierLabelSelected: { color: colors.primary },
  tierDesc: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },

  btn: {
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { ...typography.button, color: colors.onPrimary },
  btnOutline: { borderWidth: 1, borderColor: colors.border },
  btnOutlineText: { ...typography.button, color: colors.textSecondary },
  rowButtons: { flexDirection: 'row', gap: spacing.sm },

  newKeyCard: {
    gap: spacing.md,
    borderWidth: 2,
    borderColor: colors.success,
    backgroundColor: `${colors.success}12`,
  },
  newKeyTitle: { ...typography.h3, color: colors.success },
  newKeyWarning: { ...typography.body, color: colors.warning, fontWeight: '600' },
  keyDisplayBox: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  keyMonoText: { ...typography.caption, color: colors.text, fontFamily: 'monospace' },

  keyCard: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  keyCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  keyName: { ...typography.body, color: colors.text, fontWeight: '700', flex: 1 },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.round,
  },
  statusText: {
    ...typography.small,
    color: colors.background,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  keyMasked: {
    ...typography.caption,
    color: colors.textSecondary,
    fontFamily: 'monospace',
    marginBottom: spacing.sm,
  },
  keyMeta: { gap: spacing.xs, marginBottom: spacing.md },
  keyMetaText: { ...typography.caption, color: colors.textSecondary },
  keyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actionBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  actionBtnText: { ...typography.caption, color: colors.text, fontWeight: '600' },

  emptyState: { alignItems: 'center', paddingVertical: spacing.xl },
  emptyText: { ...typography.h3, color: colors.text },
  emptySubtext: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
});

export default ApiKeysScreen;
