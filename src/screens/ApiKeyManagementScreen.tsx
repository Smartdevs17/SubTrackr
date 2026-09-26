/**
 * ApiKeyManagementScreen
 *
 * Full API-key lifecycle management:
 *  - Create keys with tier-based rate limits and optional description
 *  - Rotate keys (invalidates old secret, issues new one shown once)
 *  - Revoke & delete keys
 *  - Edit scopes / permissions per key
 *  - Update expiry date
 *  - View per-key audit log
 *  - View per-key usage summary
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
  Modal,
  Switch,
} from 'react-native';
import { Card } from '../components/common/Card';
import { colors, spacing, typography, borderRadius, shadows } from '../utils/constants';
import {
  useApiStore,
  TIER_LABELS,
  ALL_SCOPES,
  KeyUsageSummary,
} from '../store/apiStore';
import { ApiKey, ApiKeyStatus, ApiKeyScope, ApiKeyAuditEntry } from '../types/sandbox';

// ─── constants ──────────────────────────────────────────────────────────────

const TIERS = Object.entries(TIER_LABELS) as [string, { label: string; desc: string }][];

const SCOPE_LABELS: Record<ApiKeyScope, string> = {
  [ApiKeyScope.READ]:      'Read',
  [ApiKeyScope.WRITE]:     'Write',
  [ApiKeyScope.ADMIN]:     'Admin',
  [ApiKeyScope.WEBHOOKS]:  'Webhooks',
  [ApiKeyScope.ANALYTICS]: 'Analytics',
};

const EXPIRY_PRESETS = [
  { label: '30 days',  days: 30 },
  { label: '90 days',  days: 90 },
  { label: '180 days', days: 180 },
  { label: '1 year',   days: 365 },
  { label: 'Never',    days: null },
];

// ─── helper ─────────────────────────────────────────────────────────────────

const statusColor = (status: ApiKeyStatus) => {
  switch (status) {
    case ApiKeyStatus.ACTIVE:  return colors.success;
    case ApiKeyStatus.REVOKED: return colors.error;
    default:                   return colors.warning;
  }
};

const formatDate = (d: Date | string | null | undefined): string => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
};

const formatDateTime = (d: Date | string | null | undefined): string => {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

const auditEventIcon = (event: ApiKeyAuditEntry['event']): string => {
  switch (event) {
    case 'created':   return '✨';
    case 'rotated':   return '🔄';
    case 'revoked':   return '🚫';
    case 'expired':   return '⏰';
    case 'validated': return '✅';
    case 'migration': return '🔀';
    default:          return '📝';
  }
};

// ─── sub-components ─────────────────────────────────────────────────────────

interface NewKeyBannerProps {
  rawKey: string;
  onDismiss: () => void;
}

const NewKeyBanner: React.FC<NewKeyBannerProps> = ({ rawKey, onDismiss }) => {
  const handleCopy = () => {
    Clipboard.setString(rawKey);
    Alert.alert('Copied', 'API key copied to clipboard.');
  };

  return (
    <Card style={[styles.section, styles.newKeyCard]}>
      <Text style={styles.newKeyTitle}>🔑 New API Key Generated</Text>
      <Text style={styles.newKeyWarning}>
        Copy this key now — it will never be shown again.
      </Text>
      <View style={styles.keyDisplayBox}>
        <Text style={styles.keyMonoText} selectable>
          {rawKey}
        </Text>
      </View>
      <View style={styles.rowButtons}>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, { flex: 1 }]}
          onPress={handleCopy}
          accessibilityLabel="Copy API key to clipboard"
          accessibilityRole="button">
          <Text style={styles.btnPrimaryText}>Copy Key</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnOutline, { flex: 1 }]}
          onPress={onDismiss}
          accessibilityLabel="Dismiss key banner"
          accessibilityRole="button">
          <Text style={styles.btnOutlineText}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );
};

// ─── detail modal ────────────────────────────────────────────────────────────

interface KeyDetailModalProps {
  apiKey: ApiKey;
  auditLog: ApiKeyAuditEntry[];
  usageSummary: KeyUsageSummary;
  maskKey: (k: string) => string;
  onClose: () => void;
  onRotate: () => void;
  onRevoke: () => void;
  onDelete: () => void;
  onSaveScopes: (scopes: ApiKeyScope[]) => void;
  onSaveExpiry: (d: Date | null) => void;
}

const KeyDetailModal: React.FC<KeyDetailModalProps> = ({
  apiKey,
  auditLog,
  usageSummary,
  maskKey,
  onClose,
  onRotate,
  onRevoke,
  onDelete,
  onSaveScopes,
  onSaveExpiry,
}) => {
  const isActive = apiKey.status === ApiKeyStatus.ACTIVE;

  // local scope state
  const [localScopes, setLocalScopes] = useState<ApiKeyScope[]>(
    apiKey.scopes ?? [ApiKeyScope.READ, ApiKeyScope.WRITE]
  );
  const [scopesDirty, setScopesDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<'details' | 'scopes' | 'audit'>('details');

  const toggleScope = (scope: ApiKeyScope) => {
    setLocalScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
    setScopesDirty(true);
  };

  const handleSaveScopes = () => {
    if (localScopes.length === 0) {
      Alert.alert('Invalid', 'A key must have at least one scope.');
      return;
    }
    onSaveScopes(localScopes);
    setScopesDirty(false);
    Alert.alert('Saved', 'Key scopes updated.');
  };

  const handleExpiryPreset = (days: number | null) => {
    if (days === null) {
      onSaveExpiry(null);
    } else {
      const d = new Date(Date.now() + days * 24 * 60 * 60 * 1_000);
      onSaveExpiry(d);
    }
  };

  const tabs: { id: 'details' | 'scopes' | 'audit'; label: string }[] = [
    { id: 'details', label: 'Details' },
    { id: 'scopes',  label: 'Scopes' },
    { id: 'audit',   label: 'Audit Log' },
  ];

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      accessibilityViewIsModal>
      <SafeAreaView style={styles.modalContainer}>
        {/* Header */}
        <View style={styles.modalHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.modalTitle} numberOfLines={1}>{apiKey.name}</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColor(apiKey.status) }]}>
              <Text style={styles.statusText}>{apiKey.status.toUpperCase()}</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeBtn}
            accessibilityLabel="Close modal"
            accessibilityRole="button">
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Masked key */}
        <View style={styles.maskedKeyRow}>
          <Text style={styles.maskedKeyText}>{maskKey(apiKey.key)}</Text>
        </View>

        {/* Tab bar */}
        <View style={styles.tabBar}>
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, activeTab === tab.id && styles.tabActive]}
              onPress={() => setActiveTab(tab.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === tab.id }}>
              <Text style={[styles.tabText, activeTab === tab.id && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.modalContent}>

          {/* ── DETAILS tab ────────────────────────────────────── */}
          {activeTab === 'details' && (
            <>
              {/* Description */}
              {apiKey.description ? (
                <Card style={styles.infoCard}>
                  <Text style={styles.infoLabel}>Description</Text>
                  <Text style={styles.infoValue}>{apiKey.description}</Text>
                </Card>
              ) : null}

              {/* Dates */}
              <Card style={styles.infoCard}>
                <Row label="Created"    value={formatDate(apiKey.createdAt)} />
                <Row label="Last used"  value={formatDate(apiKey.lastUsedAt)} />
                <Row label="Expires"    value={formatDate(apiKey.expiresAt)} />
                <Row label="Usage count" value={String(apiKey.usageCount ?? 0)} />
              </Card>

              {/* Rate limits */}
              <Card style={styles.infoCard}>
                <Text style={styles.cardSectionTitle}>Rate Limits</Text>
                <Row label="Per minute" value={`${apiKey.rateLimit?.requestsPerMinute ?? '—'} req`} />
                <Row label="Per day"    value={`${apiKey.rateLimit?.requestsPerDay ?? '—'} req`} />
              </Card>

              {/* Usage summary */}
              <Card style={styles.infoCard}>
                <Text style={styles.cardSectionTitle}>Usage Summary</Text>
                <View style={styles.usageRow}>
                  <UsageStat label="Total"   value={usageSummary.totalRequests}      color={colors.text} />
                  <UsageStat label="Success" value={usageSummary.successfulRequests} color={colors.success} />
                  <UsageStat label="Failed"  value={usageSummary.failedRequests}     color={colors.error} />
                </View>
              </Card>

              {/* Expiry presets */}
              {isActive && (
                <Card style={styles.infoCard}>
                  <Text style={styles.cardSectionTitle}>Update Expiry</Text>
                  <View style={styles.presetRow}>
                    {EXPIRY_PRESETS.map((p) => (
                      <TouchableOpacity
                        key={p.label}
                        style={styles.presetChip}
                        onPress={() => {
                          Alert.alert(
                            'Update Expiry',
                            `Set expiry to "${p.label}"?`,
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Confirm',
                                onPress: () => {
                                  handleExpiryPreset(p.days);
                                  Alert.alert('Updated', `Expiry set to ${p.label}.`);
                                },
                              },
                            ]
                          );
                        }}
                        accessibilityLabel={`Set expiry to ${p.label}`}
                        accessibilityRole="button">
                        <Text style={styles.presetChipText}>{p.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </Card>
              )}

              {/* Actions */}
              <View style={styles.actionGroup}>
                {isActive && (
                  <>
                    <TouchableOpacity
                      style={[styles.btn, styles.btnWarning]}
                      onPress={onRotate}
                      accessibilityLabel="Rotate API key"
                      accessibilityRole="button">
                      <Text style={styles.btnWarningText}>🔄  Rotate Key</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btn, styles.btnDanger]}
                      onPress={onRevoke}
                      accessibilityLabel="Revoke API key"
                      accessibilityRole="button">
                      <Text style={styles.btnDangerText}>🚫  Revoke Key</Text>
                    </TouchableOpacity>
                  </>
                )}
                <TouchableOpacity
                  style={[styles.btn, styles.btnOutline, { borderColor: colors.error }]}
                  onPress={onDelete}
                  accessibilityLabel="Delete API key"
                  accessibilityRole="button">
                  <Text style={[styles.btnOutlineText, { color: colors.error }]}>
                    🗑  Delete Key
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ── SCOPES tab ─────────────────────────────────────── */}
          {activeTab === 'scopes' && (
            <>
              <Text style={styles.scopeHint}>
                Control what this key can access. At least one scope is required.
              </Text>
              {ALL_SCOPES.map((scope) => {
                const isEnabled = localScopes.includes(scope);
                return (
                  <View key={scope} style={styles.scopeRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.scopeLabel}>{SCOPE_LABELS[scope]}</Text>
                      <Text style={styles.scopeDesc}>{scopeDescription(scope)}</Text>
                    </View>
                    <Switch
                      value={isEnabled}
                      onValueChange={() => isActive && toggleScope(scope)}
                      disabled={!isActive}
                      trackColor={{ false: colors.surfaceVariant, true: colors.primary }}
                      thumbColor={isEnabled ? colors.onPrimary : colors.textSecondary}
                      accessibilityLabel={`Toggle ${SCOPE_LABELS[scope]} scope`}
                    />
                  </View>
                );
              })}
              {isActive && scopesDirty && (
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary, { marginTop: spacing.md }]}
                  onPress={handleSaveScopes}
                  accessibilityLabel="Save scope changes"
                  accessibilityRole="button">
                  <Text style={styles.btnPrimaryText}>Save Scopes</Text>
                </TouchableOpacity>
              )}
              {!isActive && (
                <Text style={styles.disabledNote}>
                  Scopes cannot be edited for a {apiKey.status} key.
                </Text>
              )}
            </>
          )}

          {/* ── AUDIT LOG tab ──────────────────────────────────── */}
          {activeTab === 'audit' && (
            <>
              {auditLog.length === 0 ? (
                <Text style={styles.emptySubtext}>No audit entries yet.</Text>
              ) : (
                auditLog.map((entry) => (
                  <View key={entry.id} style={styles.auditEntry}>
                    <Text style={styles.auditIcon}>{auditEventIcon(entry.event)}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.auditMessage}>{entry.message}</Text>
                      <Text style={styles.auditTime}>{formatDateTime(entry.timestamp)}</Text>
                    </View>
                  </View>
                ))
              )}
            </>
          )}

        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

// tiny helpers inside modal
const Row = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value}</Text>
  </View>
);

const UsageStat = ({ label, value, color }: { label: string; value: number; color: string }) => (
  <View style={styles.usageStat}>
    <Text style={[styles.usageStatValue, { color }]}>{value}</Text>
    <Text style={styles.usageStatLabel}>{label}</Text>
  </View>
);

const scopeDescription = (scope: ApiKeyScope): string => {
  switch (scope) {
    case ApiKeyScope.READ:      return 'Read-only access to subscription data';
    case ApiKeyScope.WRITE:     return 'Create and update subscriptions';
    case ApiKeyScope.ADMIN:     return 'Full admin access including user management';
    case ApiKeyScope.WEBHOOKS:  return 'Manage and receive webhook events';
    case ApiKeyScope.ANALYTICS: return 'Access analytics and reporting endpoints';
  }
};

// ─── main screen ─────────────────────────────────────────────────────────────

const ApiKeyManagementScreen: React.FC = () => {
  const {
    apiKeys,
    createApiKey,
    revokeApiKey,
    rotateApiKey,
    deleteApiKey,
    getKeyStats,
    getKeyAuditLog,
    getKeyUsageSummary,
    updateKeyPermissions,
    updateKeyExpiry,
    maskKey,
  } = useApiStore();

  // form state
  const [newKeyName, setNewKeyName]         = useState('');
  const [newKeyDesc, setNewKeyDesc]         = useState('');
  const [selectedTier, setSelectedTier]     = useState('free');
  const [showNewKey, setShowNewKey]         = useState<string | null>(null);

  // detail modal state
  const [selectedKey, setSelectedKey]       = useState<ApiKey | null>(null);

  const stats = getKeyStats();

  // ── handlers ──────────────────────────────────────────────────────────────

  const handleCreateKey = useCallback(() => {
    const name = newKeyName.trim();
    if (!name) {
      Alert.alert('Name required', 'Please enter a name for the API key.');
      return;
    }

    const created = createApiKey(name, selectedTier as 'free' | 'basic' | 'pro' | 'enterprise', newKeyDesc.trim() || undefined);
    setShowNewKey(created.key);
    setNewKeyName('');
    setNewKeyDesc('');
  }, [newKeyName, newKeyDesc, selectedTier, createApiKey]);

  const handleRotate = useCallback((keyId: string, keyName: string) => {
    Alert.alert(
      'Rotate API Key',
      `Rotating "${keyName}" will immediately invalidate the current secret. Any integrations using the old key will break until updated. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rotate',
          onPress: () => {
            const newRaw = rotateApiKey(keyId);
            if (newRaw) {
              setSelectedKey(null); // close modal first
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
      'Revoke API Key',
      `Revoking "${keyName}" will immediately invalidate it. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: () => {
            revokeApiKey(keyId);
            setSelectedKey(null);
          },
        },
      ]
    );
  }, [revokeApiKey]);

  const handleDelete = useCallback((keyId: string, keyName: string) => {
    Alert.alert(
      'Delete API Key',
      `Permanently delete "${keyName}"? Usage logs for this key will also be removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteApiKey(keyId);
            setSelectedKey(null);
          },
        },
      ]
    );
  }, [deleteApiKey]);

  const handleSaveScopes = useCallback((keyId: string, scopes: ApiKeyScope[]) => {
    updateKeyPermissions(keyId, scopes);
  }, [updateKeyPermissions]);

  const handleSaveExpiry = useCallback((keyId: string, d: Date | null) => {
    updateKeyExpiry(keyId, d);
    // sync selected key state so modal reflects new expiry instantly
    setSelectedKey((prev) => prev ? { ...prev, expiresAt: d } : prev);
  }, [updateKeyExpiry]);

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>

        {/* Header */}
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>API Key Management</Text>
          <Text style={styles.pageSubtitle}>
            Create, rotate, and manage API keys for the SubTrackr API
          </Text>
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
          <NewKeyBanner rawKey={showNewKey} onDismiss={() => setShowNewKey(null)} />
        )}

        {/* Create form */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Generate New Key</Text>

          <Text style={styles.fieldLabel}>Key Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Production Backend"
            placeholderTextColor={colors.textSecondary}
            value={newKeyName}
            onChangeText={setNewKeyName}
            accessibilityLabel="API key name"
          />

          <Text style={styles.fieldLabel}>Description (optional)</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            placeholder="What will this key be used for?"
            placeholderTextColor={colors.textSecondary}
            value={newKeyDesc}
            onChangeText={setNewKeyDesc}
            multiline
            numberOfLines={2}
            accessibilityLabel="API key description"
          />

          <Text style={styles.fieldLabel}>Usage Tier</Text>
          <View style={styles.tierGrid}>
            {TIERS.map(([tierKey, info]) => (
              <TouchableOpacity
                key={tierKey}
                style={[
                  styles.tierCard,
                  selectedTier === tierKey && styles.tierCardSelected,
                ]}
                onPress={() => setSelectedTier(tierKey)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selectedTier === tierKey }}
                accessibilityLabel={`Select ${info.label} tier`}>
                <Text style={[
                  styles.tierLabel,
                  selectedTier === tierKey && styles.tierLabelSelected,
                ]}>
                  {info.label}
                </Text>
                <Text style={styles.tierDesc}>{info.desc}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary]}
            onPress={handleCreateKey}
            accessibilityLabel="Generate new API key"
            accessibilityRole="button">
            <Text style={styles.btnPrimaryText}>Generate API Key</Text>
          </TouchableOpacity>
        </Card>

        {/* Keys list */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Your API Keys</Text>

          {apiKeys.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🔑</Text>
              <Text style={styles.emptyText}>No API keys yet</Text>
              <Text style={styles.emptySubtext}>Generate a key above to get started</Text>
            </View>
          ) : (
            apiKeys.map((key) => (
              <TouchableOpacity
                key={key.id}
                style={styles.keyCard}
                onPress={() => setSelectedKey(key)}
                accessibilityLabel={`Open details for ${key.name}`}
                accessibilityRole="button">
                <View style={styles.keyCardTop}>
                  <Text style={styles.keyName} numberOfLines={1}>{key.name}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: statusColor(key.status) }]}>
                    <Text style={styles.statusText}>{key.status.toUpperCase()}</Text>
                  </View>
                </View>

                <Text style={styles.keyMasked}>{maskKey(key.key)}</Text>

                <View style={styles.keyMeta}>
                  <Text style={styles.keyMetaText}>
                    Scopes: {(key.scopes ?? [ApiKeyScope.READ]).join(', ')}
                  </Text>
                  <Text style={styles.keyMetaText}>
                    Expires: {formatDate(key.expiresAt)}
                  </Text>
                  {key.lastUsedAt && (
                    <Text style={styles.keyMetaText}>
                      Last used: {formatDate(key.lastUsedAt)}
                    </Text>
                  )}
                </View>

                {/* Quick-action row */}
                <View style={styles.quickActions}>
                  {key.status === ApiKeyStatus.ACTIVE && (
                    <>
                      <TouchableOpacity
                        style={styles.quickBtn}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          handleRotate(key.id, key.name);
                        }}
                        accessibilityLabel={`Rotate ${key.name}`}
                        accessibilityRole="button">
                        <Text style={styles.quickBtnText}>🔄 Rotate</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.quickBtn, { borderColor: colors.error }]}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          handleRevoke(key.id, key.name);
                        }}
                        accessibilityLabel={`Revoke ${key.name}`}
                        accessibilityRole="button">
                        <Text style={[styles.quickBtnText, { color: colors.error }]}>
                          🚫 Revoke
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                  <TouchableOpacity
                    style={styles.quickBtn}
                    onPress={(e) => {
                      e.stopPropagation?.();
                      handleDelete(key.id, key.name);
                    }}
                    accessibilityLabel={`Delete ${key.name}`}
                    accessibilityRole="button">
                    <Text style={styles.quickBtnText}>🗑 Delete</Text>
                  </TouchableOpacity>
                  <View style={styles.detailHint}>
                    <Text style={styles.detailHintText}>Tap card for details →</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
        </Card>

        {/* Best practices */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Best Practices</Text>
          {[
            { icon: '🔒', title: 'Keep keys secure', body: 'Never expose API keys in client-side code, public repos, or shared documents.' },
            { icon: '🔄', title: 'Rotate regularly', body: 'Rotate keys periodically and immediately after any suspected compromise.' },
            { icon: '🎯', title: 'Least privilege', body: 'Only grant the scopes each integration actually needs.' },
            { icon: '📊', title: 'Monitor usage', body: 'Review usage via the Audit Log tab and revoke any unexpected or unused keys.' },
          ].map(({ icon, title, body }) => (
            <View key={title} style={styles.bestPracticeRow}>
              <Text style={styles.bpTitle}>{icon}  {title}</Text>
              <Text style={styles.bpBody}>{body}</Text>
            </View>
          ))}
        </Card>

      </ScrollView>

      {/* Key detail modal */}
      {selectedKey && (
        <KeyDetailModal
          apiKey={selectedKey}
          auditLog={getKeyAuditLog(selectedKey.id)}
          usageSummary={getKeyUsageSummary(selectedKey.id)}
          maskKey={maskKey}
          onClose={() => setSelectedKey(null)}
          onRotate={() => handleRotate(selectedKey.id, selectedKey.name)}
          onRevoke={() => handleRevoke(selectedKey.id, selectedKey.name)}
          onDelete={() => handleDelete(selectedKey.id, selectedKey.name)}
          onSaveScopes={(scopes) => handleSaveScopes(selectedKey.id, scopes)}
          onSaveExpiry={(d) => handleSaveExpiry(selectedKey.id, d)}
        />
      )}
    </SafeAreaView>
  );
};

// ─── styles ──────────────────────────────────────────────────────────────────

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

  // page header
  pageHeader: { marginBottom: spacing.sm },
  pageTitle: { ...typography.h1, color: colors.text },
  pageSubtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },

  // stats
  statsGrid: { flexDirection: 'row', gap: spacing.sm },
  statCard: { flex: 1, alignItems: 'center', padding: spacing.md },
  statValue: { ...typography.h2, fontWeight: '800' },
  statLabel: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },

  // sections / cards
  section: { gap: spacing.md },
  sectionTitle: { ...typography.h3, color: colors.text },

  // new key banner
  newKeyCard: {
    borderWidth: 2,
    borderColor: colors.success,
    backgroundColor: `${colors.success}12`,
  },
  newKeyTitle:   { ...typography.h3, color: colors.success },
  newKeyWarning: { ...typography.body, color: colors.warning, fontWeight: '600' },
  keyDisplayBox: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  keyMonoText: {
    ...typography.caption,
    color: colors.text,
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },

  // form
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
  inputMultiline: { minHeight: 60, textAlignVertical: 'top' },

  // tier picker
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
  tierCardSelected: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}18`,
  },
  tierLabel: { ...typography.body, color: colors.text, fontWeight: '700' },
  tierLabelSelected: { color: colors.primary },
  tierDesc: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },

  // buttons
  btn: {
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { ...typography.button, color: colors.onPrimary },
  btnOutline: { borderWidth: 1, borderColor: colors.border },
  btnOutlineText: { ...typography.button, color: colors.textSecondary },
  btnWarning: { backgroundColor: `${colors.warning}22`, borderWidth: 1, borderColor: colors.warning },
  btnWarningText: { ...typography.button, color: colors.warning },
  btnDanger: { backgroundColor: `${colors.error}22`, borderWidth: 1, borderColor: colors.error },
  btnDangerText: { ...typography.button, color: colors.error },
  rowButtons: { flexDirection: 'row', gap: spacing.sm },

  // key cards
  keyCard: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  keyCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  keyName: { ...typography.body, color: colors.text, fontWeight: '700', flex: 1 },
  keyMasked: {
    ...typography.caption,
    color: colors.textSecondary,
    fontFamily: 'monospace',
    marginBottom: spacing.sm,
  },
  keyMeta: { gap: spacing.xs, marginBottom: spacing.md },
  keyMetaText: { ...typography.caption, color: colors.textSecondary },
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    alignItems: 'center',
  },
  quickBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  quickBtnText: { ...typography.caption, color: colors.text, fontWeight: '600' },
  detailHint: { marginLeft: 'auto' },
  detailHintText: { ...typography.small, color: colors.primary },

  // status badge
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.round,
    alignSelf: 'flex-start',
  },
  statusText: {
    ...typography.small,
    color: colors.background,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // empty state
  emptyState: { alignItems: 'center', paddingVertical: spacing.xl },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyText: { ...typography.h3, color: colors.text },
  emptySubtext: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },

  // best practices
  bestPracticeRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  bpTitle: { ...typography.body, color: colors.text, fontWeight: '600' },
  bpBody: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 18 },

  // ── modal ─────────────────────────────────────────────────────────────────
  modalContainer: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  modalTitle: { ...typography.h2, color: colors.text, marginBottom: spacing.xs },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.round,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: { ...typography.body, color: colors.text, fontWeight: '700' },
  maskedKeyRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  maskedKeyText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontFamily: 'monospace',
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
  },
  tabText: { ...typography.body, color: colors.textSecondary },
  tabTextActive: { color: colors.primary, fontWeight: '700' },
  modalContent: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },

  // info card inside modal
  infoCard: { gap: spacing.xs },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  infoLabel: { ...typography.caption, color: colors.textSecondary },
  infoValue: { ...typography.caption, color: colors.text, fontWeight: '600', textAlign: 'right', flex: 1 },
  cardSectionTitle: { ...typography.body, color: colors.text, fontWeight: '700', marginBottom: spacing.xs },

  // usage stats
  usageRow: { flexDirection: 'row', justifyContent: 'space-around' },
  usageStat: { alignItems: 'center' },
  usageStatValue: { ...typography.h2, fontWeight: '800' },
  usageStatLabel: { ...typography.caption, color: colors.textSecondary },

  // expiry presets
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  presetChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.round,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}15`,
  },
  presetChipText: { ...typography.caption, color: colors.primary, fontWeight: '600' },

  // scope toggle rows
  scopeHint: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  scopeLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
  scopeDesc: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  disabledNote: { ...typography.caption, color: colors.warning, textAlign: 'center', marginTop: spacing.md },

  // audit log
  auditEntry: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: 'flex-start',
  },
  auditIcon: { fontSize: 18 },
  auditMessage: { ...typography.body, color: colors.text },
  auditTime: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },

  // action group
  actionGroup: { gap: spacing.sm, marginTop: spacing.sm },
});

export default ApiKeyManagementScreen;
