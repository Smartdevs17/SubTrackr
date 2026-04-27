import React, { useState, useMemo } from 'react';
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
import { FeatureId, FeatureFlag } from '../types/feature';
import { SubscriptionTier } from '../types/subscription';
import { featureFlagsService } from '../services/featureFlags';
import { colors, spacing, typography, borderRadius, shadows } from '../utils/constants';

interface FeatureManagementProps {
  onFeatureUpdate?: (featureId: FeatureId, updates: Partial<FeatureFlag>) => void;
}

/**
 * Administrative component for managing feature flags
 */
export const FeatureManagement: React.FC<FeatureManagementProps> = ({ onFeatureUpdate }) => {
  const [editingFeature, setEditingFeature] = useState<FeatureId | null>(null);
  const [rolloutPercentage, setRolloutPercentage] = useState<string>('');

  const features = useMemo(() => {
    return featureFlagsService.getAllFeatures();
  }, []);

  const handleFeatureToggle = (featureId: FeatureId, enabled: boolean) => {
    const feature = features[featureId];
    if (feature) {
      const updatedFeature = { ...feature, enabled };
      onFeatureUpdate?.(featureId, updatedFeature);
    }
  };

  const handleRolloutUpdate = (featureId: FeatureId) => {
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
    }
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
      <View key={featureId} style={styles.featureCard}>
        <View style={styles.featureHeader}>
          <View style={styles.featureInfo}>
            <Text style={styles.featureName}>{feature.name}</Text>
            <Text style={styles.featureDescription}>{feature.description}</Text>
          </View>
          <Switch
            value={feature.enabled}
            onValueChange={(enabled) => handleFeatureToggle(featureId, enabled)}
            trackColor={{ false: colors.surface, true: colors.primary }}
            thumbColor={feature.enabled ? colors.surface : colors.textSecondary}
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
            {isEditing ? (
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
                  setEditingFeature(featureId);
                  setRolloutPercentage(`${feature.rolloutPercentage || 100}`);
                }}>
                <Text style={styles.rolloutText}>{feature.rolloutPercentage || 100}%</Text>
                <Text style={styles.editText}>Tap to edit</Text>
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
});
