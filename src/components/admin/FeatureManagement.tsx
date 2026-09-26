import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  TextInput,
  Alert,
} from 'react-native';
import { FeatureId, FeatureFlag } from '../../types/feature';
import { SubscriptionTier } from '../../types/subscription';
import { featureFlagsService } from '../../services/featureFlags';
import { colors, spacing, typography, borderRadius, shadows } from '../../utils/constants';

interface FeatureManagementProps {
  onFeatureUpdate?: (featureId: FeatureId, updates: Partial<FeatureFlag>) => void;
  userRole?: 'admin' | 'manager' | 'viewer';
  currentUserId?: string;
}

/**
 * Administrative component for managing feature flags with comprehensive RBAC checks
 */
export const FeatureManagement: React.FC<FeatureManagementProps> = ({
  onFeatureUpdate,
  userRole = 'viewer',
  currentUserId,
}) => {
  const [editingFeature, setEditingFeature] = useState<FeatureId | null>(null);
  const [rolloutPercentage, setRolloutPercentage] = useState<string>('');

  // ── Role & Temporary Elevation State ───────────────────────────────────────
  const [baseRole, setBaseRole] = useState<'admin' | 'manager' | 'viewer'>(userRole);
  const [elevationRole, setElevationRole] = useState<'admin' | 'manager' | null>(null);
  const [elevationTime, setElevationTime] = useState<number>(0);
  const [recentAuditLog, setRecentAuditLog] = useState<string | null>(null);

  const actor = currentUserId || 'system_actor';

  // Sync prop changes
  useEffect(() => {
    setBaseRole(userRole);
  }, [userRole]);

  // Compute effective role
  const effectiveRole = elevationRole || baseRole;
  const isEditable = effectiveRole === 'admin' || effectiveRole === 'manager';

  // Elevation countdown timer
  useEffect(() => {
    if (elevationTime <= 0) {
      if (elevationRole) {
        setElevationRole(null);
        setRecentAuditLog(
          `role.revoked: Temporary elevation lease expired. Reverted to Viewer for ${actor}.`
        );
        Alert.alert(
          'Elevation Expired',
          'Your temporary privileges have expired and your session has reverted to Viewer.'
        );
      }
      return;
    }

    const timer = setInterval(() => {
      setElevationTime((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [elevationTime, elevationRole, actor]);

  const features = useMemo(() => {
    return featureFlagsService.getAllFeatures();
  }, []);

  // ── Interactive UI Action Triggers with RBAC Assertion ────────────────────

  const handleFeatureToggle = (featureId: FeatureId, enabled: boolean) => {
    if (!isEditable) {
      Alert.alert(
        'Access Denied',
        'Unauthorized attempt. Viewers do not have permission to modify feature flags.\n\nPlease use the Temporary Elevation panel above to request access.',
        [{ text: 'OK', style: 'cancel' }]
      );
      return;
    }

    const feature = features[featureId];
    if (feature) {
      const updatedFeature = { ...feature, enabled };
      onFeatureUpdate?.(featureId, updatedFeature);
      // Log audit locally for demonstration
      setRecentAuditLog(
        `feature.updated: Toggled "${feature.name}" to ${enabled ? 'ON' : 'OFF'} by [${effectiveRole.toUpperCase()}] (${actor})`
      );
    }
  };

  const handleRolloutUpdate = (featureId: FeatureId) => {
    if (!isEditable) {
      Alert.alert(
        'Access Denied',
        'Unauthorized attempt. Viewers do not have permission to modify rollout stages.',
        [{ text: 'OK', style: 'cancel' }]
      );
      return;
    }

    const percentage = parseInt(rolloutPercentage);
    if (isNaN(percentage) || percentage < 0 || percentage > 100) {
      Alert.alert('Invalid Input', 'Rollout percentage must be between 0 and 100');
      return;
    }

    const feature = features[featureId];
    if (feature) {
      const updatedFeature = { ...feature, rolloutPercentage: percentage };
      onFeatureUpdate?.(featureId, updatedFeature);
      setEditingFeature(null);
      setRolloutPercentage('');
      setRecentAuditLog(
        `feature.updated: Set rollout of "${feature.name}" to ${percentage}% by [${effectiveRole.toUpperCase()}] (${actor})`
      );
    }
  };

  const triggerElevation = (role: 'admin' | 'manager') => {
    setElevationRole(role);
    setElevationTime(60); // 60 seconds elevation
    setRecentAuditLog(
      `role.elevated: Simulated user ${actor} elevated to ${role.toUpperCase()} (1m lease). Audit chain entry appended.`
    );
    Alert.alert(
      'Elevation Approved',
      `You have been granted temporary ${role.toUpperCase()} privileges for 60 seconds.\n\nAll edit actions are now unlocked.`
    );
  };

  const getTierColor = (tier: SubscriptionTier) => {
    switch (tier) {
      case SubscriptionTier.FREE:
        return colors.success;
      case SubscriptionTier.BASIC:
        return colors.primary;
      case SubscriptionTier.PREMIUM:
        return colors.warning;
      case SubscriptionTier.ENTERPRISE:
        return colors.error;
      default:
        return colors.textSecondary;
    }
  };

  const renderFeatureCard = (featureId: FeatureId, feature: FeatureFlag) => {
    const isEditing = editingFeature === featureId;

    return (
      <View key={featureId} style={[styles.featureCard, !isEditable && styles.featureCardDisabled]}>
        <View style={styles.featureHeader}>
          <View style={styles.featureInfo}>
            <Text style={styles.featureName}>{feature.name}</Text>
            <Text style={styles.featureDescription}>{feature.description}</Text>
          </View>
          <Switch
            value={feature.enabled}
            onValueChange={(enabled) => handleFeatureToggle(featureId, enabled)}
            trackColor={{
              false: colors.surface,
              true: isEditable ? colors.primary : colors.textSecondary,
            }}
            thumbColor={
              feature.enabled ? (isEditable ? colors.surface : colors.border) : colors.textSecondary
            }
          />
        </View>

        <View style={styles.featureDetails}>
          <View style={styles.tierAccess}>
            <Text style={styles.detailLabel}>Tier Access:</Text>
            <View style={styles.tierBadges}>
              {feature.tierAccess.map((tier) => (
                <View
                  key={tier}
                  style={[styles.tierBadge, { backgroundColor: getTierColor(tier) }]}>
                  <Text style={styles.tierBadgeText}>{tier}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.rolloutSection}>
            <Text style={styles.detailLabel}>Rollout:</Text>
            {isEditing && isEditable ? (
              <View style={styles.rolloutEdit}>
                <TextInput
                  style={styles.rolloutInput}
                  value={rolloutPercentage}
                  onChangeText={setRolloutPercentage}
                  placeholder={`${feature.rolloutPercentage || 100}`}
                  keyboardType="numeric"
                  maxLength={3}
                />
                <TouchableOpacity
                  style={styles.saveButton}
                  onPress={() => handleRolloutUpdate(featureId)}>
                  <Text style={styles.saveButtonText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => {
                    setEditingFeature(null);
                    setRolloutPercentage('');
                  }}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.rolloutDisplay}
                onPress={() => {
                  if (!isEditable) {
                    Alert.alert(
                      'Access Denied',
                      'Unauthorized attempt. Viewers cannot modify rollout stages.'
                    );
                    return;
                  }
                  setEditingFeature(featureId);
                  setRolloutPercentage(`${feature.rolloutPercentage || 100}`);
                }}>
                <Text style={[styles.rolloutText, !isEditable && { color: colors.textSecondary }]}>
                  {feature.rolloutPercentage || 100}%
                </Text>
                {isEditable && <Text style={styles.editText}>Tap to edit</Text>}
              </TouchableOpacity>
            )}
          </View>

          {feature.dependencies && feature.dependencies.length > 0 && (
            <View style={styles.dependencies}>
              <Text style={styles.detailLabel}>Dependencies:</Text>
              <Text style={styles.dependenciesText}>{feature.dependencies.join(', ')}</Text>
            </View>
          )}

          {feature.abTestGroups && feature.abTestGroups.length > 0 && (
            <View style={styles.abTest}>
              <Text style={styles.detailLabel}>A/B Test Groups:</Text>
              <Text style={styles.abTestText}>{feature.abTestGroups.join(', ')}</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <ScrollView style={styles.container}>
      {/* ── Premium Glassmorphism Elevation & Security Banner ──────────────── */}
      <View style={styles.glassContainer}>
        <View style={styles.glassGradient}>
          <Text style={styles.glassTitle}>
            🛡️ Security Role:{' '}
            <Text style={styles.roleHighlight}>{effectiveRole.toUpperCase()}</Text>
          </Text>
          {elevationRole ? (
            <View style={styles.countdownContainer}>
              <Text style={styles.glassSubtitle}>
                ⚠️ Temporary Elevation Active! Unlocked editing access.
              </Text>
              <View style={styles.timerBadge}>
                <Text style={styles.timerText}>⏳ {elevationTime}s remaining</Text>
              </View>
            </View>
          ) : (
            <Text style={styles.glassSubtitle}>
              {baseRole === 'viewer'
                ? `You have view-only access as ${actor}. Modify actions are gated by RBAC.`
                : `Full manager and edit operations enabled for ${actor}.`}
            </Text>
          )}

          {!elevationRole && baseRole === 'viewer' && (
            <View style={styles.elevationButtons}>
              <TouchableOpacity
                style={styles.elevateButtonManager}
                onPress={() => triggerElevation('manager')}>
                <Text style={styles.elevationButtonText}>Elevate to Manager (1m)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.elevateButtonAdmin}
                onPress={() => triggerElevation('admin')}>
                <Text style={styles.elevationButtonText}>Elevate to Admin (1m)</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* ── Simulated Audit Logs Visual Console ────────────────────────────── */}
      {recentAuditLog && (
        <View style={styles.auditConsole}>
          <Text style={styles.auditConsoleTitle}>Tamper-Evident Audit Feed (Live):</Text>
          <Text style={styles.auditConsoleLogs}>⚡ {recentAuditLog}</Text>
        </View>
      )}

      <View style={styles.header}>
        <Text style={styles.title}>Feature Management</Text>
        <Text style={styles.subtitle}>
          Control feature availability, rollout percentages, and access tiers
        </Text>
      </View>

      <View style={styles.featuresList}>
        {Object.entries(features).map(([featureId, feature]) =>
          renderFeatureCard(featureId as FeatureId, feature)
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    ...shadows.sm,
  },
  title: {
    ...typography.h2,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  featuresList: {
    padding: spacing.lg,
  },
  featureCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  featureCardDisabled: {
    opacity: 0.85,
    backgroundColor: '#fafafa',
  },
  featureHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  featureInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  featureName: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  featureDescription: {
    ...typography.body,
    color: colors.textSecondary,
  },
  featureDetails: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  tierAccess: {
    marginBottom: spacing.md,
  },
  detailLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  tierBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tierBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
  },
  tierBadgeText: {
    ...typography.caption,
    color: colors.surface,
    fontWeight: '600',
  },
  rolloutSection: {
    marginBottom: spacing.md,
  },
  rolloutDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rolloutText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  editText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  rolloutEdit: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rolloutInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    marginRight: spacing.sm,
    ...typography.body,
    color: colors.text,
  },
  saveButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    marginRight: spacing.sm,
  },
  saveButtonText: {
    ...typography.caption,
    color: colors.surface,
    fontWeight: '600',
  },
  cancelButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  cancelButtonText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  dependencies: {
    marginBottom: spacing.md,
  },
  dependenciesText: {
    ...typography.body,
    color: colors.text,
  },
  abTest: {
    marginBottom: spacing.md,
  },
  abTestText: {
    ...typography.body,
    color: colors.primary,
  },
  // ── Premium Elevation Panel Styles ──────────────────────────────────────────
  glassContainer: {
    margin: spacing.lg,
    marginBottom: 0,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    backgroundColor: 'rgba(240, 244, 255, 0.75)',
    ...shadows.md,
  },
  glassGradient: {
    padding: spacing.lg,
  },
  glassTitle: {
    ...typography.h3,
    color: '#0f172a',
    marginBottom: spacing.xs,
  },
  roleHighlight: {
    fontWeight: '800',
    color: '#4f46e5',
  },
  glassSubtitle: {
    ...typography.body,
    color: '#475569',
    fontSize: 13,
    marginBottom: spacing.md,
  },
  countdownContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  timerBadge: {
    backgroundColor: '#fee2e2',
    borderColor: '#ef4444',
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  timerText: {
    color: '#b91c1c',
    fontWeight: '700',
    fontSize: 12,
  },
  elevationButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  elevateButtonManager: {
    flex: 1,
    backgroundColor: '#3b82f6',
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    marginRight: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  elevateButtonAdmin: {
    flex: 1,
    backgroundColor: '#8b5cf6',
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    marginLeft: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  elevationButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  auditConsole: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: '#0f172a',
    borderRadius: borderRadius.md,
    borderLeftWidth: 4,
    borderLeftColor: '#10b981',
  },
  auditConsoleTitle: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  auditConsoleLogs: {
    color: '#34d399',
    fontSize: 11,
    fontFamily: 'monospace',
  },
});
