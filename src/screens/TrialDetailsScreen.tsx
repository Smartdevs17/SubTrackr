import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useThemeColors } from '../hooks/useThemeColors';
import { useTrialStore } from '../store';
import { trialConfigService, abTestService, conversionTracker, reminderScheduler } from '../services/trialService';
import { TrialStatus, TrialDuration, TrialFeatureAccess, PaymentRequirement, TrialReminder } from '../types/trial';
import { FormScreen } from '../components/common/ScreenTemplates';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { spacing, typography, borderRadius } from '../utils/constants';

type TrialDetailsRouteProp = RouteProp<RootStackParamList, 'TrialDetails'>;

interface ConversionFunnelData {
  eventType: string;
  count: number;
  percentage: number;
}

export const TrialDetailsScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<TrialDetailsRouteProp>();
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const { trialConfigs, abTestAssignments, conversionFunnel, isLoading, error } = useTrialStore();

  const [selectedTrial, setSelectedTrial] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTrialConfig, setNewTrialConfig] = useState({
    subscriptionId: '',
    duration: TrialDuration.SEVEN_DAYS,
    featureAccess: TrialFeatureAccess.FULL,
    paymentRequirement: PaymentRequirement.REQUIRED,
    abTestId: '',
  });

  useEffect(() => {
    if (route.params?.trialId) {
      setSelectedTrial(route.params.trialId);
    }
  }, [route.params]);

  const selectedTrialConfig = selectedTrial
    ? trialConfigs.find((tc) => tc.id === selectedTrial)
    : null;

  const getFunnelSteps = (trialId: string): ConversionFunnelData[] => {
    const events = conversionTracker.getFunnelForTrial(trialId);
    const steps: Record<string, number> = {};
    events.forEach((e) => {
      steps[e.eventType] = (steps[e.eventType] || 0) + 1;
    });
    const total = events.length || 1;
    return Object.entries(steps).map(([eventType, count]) => ({
      eventType,
      count,
      percentage: (count / total) * 100,
    }));
  };

  const handleCreateTrial = async () => {
    try {
      await trialConfigService.create(
        newTrialConfig.subscriptionId,
        newTrialConfig.duration,
        newTrialConfig.featureAccess,
        newTrialConfig.paymentRequirement,
        newTrialConfig.abTestId || undefined
      );
      setShowCreateForm(false);
      setNewTrialConfig({
        subscriptionId: '',
        duration: TrialDuration.SEVEN_DAYS,
        featureAccess: TrialFeatureAccess.FULL,
        paymentRequirement: PaymentRequirement.REQUIRED,
        abTestId: '',
      });
    } catch {
      // Error handled by service
    }
  };

  const handleConvertTrial = async (trialId: string) => {
    await useTrialStore.getState().convertTrial(trialId);
    await conversionTracker.track({
      trialConfigId: trialId,
      eventType: 'trial_converted',
      userId: 'current-user',
    });
  };

  const handleExpireTrial = async (trialId: string) => {
    await useTrialStore.getState().expireTrial(trialId);
    await conversionTracker.track({
      trialConfigId: trialId,
      eventType: 'trial_expired',
      userId: 'current-user',
    });
  };

  const renderStatusBadge = (status: TrialStatus) => {
    let backgroundColor = colors.border.default;
    let textColor = colors.text;

    switch (status) {
      case TrialStatus.ACTIVE:
        backgroundColor = colors.primary;
        textColor = colors.background;
        break;
      case TrialStatus.CONVERTED:
        backgroundColor = colors.success;
        textColor = colors.background;
        break;
      case TrialStatus.EXPIRED:
        backgroundColor = colors.warning;
        textColor = colors.background;
        break;
      case TrialStatus.CANCELLED:
        backgroundColor = colors.error;
        textColor = colors.background;
        break;
    }

    return (
      <View style={[styles.statusBadge, { backgroundColor }]}>
        <Text style={[styles.statusText, { color: textColor }]}>{status.toUpperCase()}</Text>
      </View>
    );
  };

  const renderTrialCard = (trial: any) => (
    <TouchableOpacity
      key={trial.id}
      onPress={() => setSelectedTrial(trial.id)}
      style={styles.trialCard}
    >
      <View style={styles.trialCardHeader}>
        <Text style={styles.trialCardTitle}>Trial {trial.id.substring(0, 8)}</Text>
        {renderStatusBadge(trial.status)}
      </View>
      <View style={styles.trialCardMeta}>
        <Text style={styles.trialCardMetaText}>
          Duration: {TrialDuration[trial.duration] || trial.duration}
        </Text>
        <Text style={styles.trialCardMetaText}>
          Access: {TrialFeatureAccess[trial.featureAccess] || trial.featureAccess}
        </Text>
      </View>
      {trial.abTestId && (
        <View style={styles.abTestTag}>
          <Text style={styles.abTestText}>A/B Test: {trial.abTestId}</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  const renderFunnelChart = (steps: ConversionFunnelData[]) => {
    if (steps.length === 0) {
      return <Text style={styles.emptyText}>No funnel data available</Text>;
    }

    const maxCount = Math.max(...steps.map((s) => s.count));

    return (
      <View style={styles.funnelContainer}>
        {steps.map((step, index) => (
          <View key={step.eventType} style={styles.funnelStep}>
            <View style={styles.funnelStepHeader}>
              <Text style={styles.funnelStepLabel}>{step.eventType.replace(/_/g, ' ')}</Text>
              <Text style={styles.funnelStepCount}>{step.count}</Text>
            </View>
            <View style={styles.funnelBarContainer}>
              <View
                style={[
                  styles.funnelBar,
                  {
                    width: `${(step.count / maxCount) * 100}%`,
                    backgroundColor: colors.primary,
                  },
                ]}
              />
            </View>
            <Text style={styles.funnelPercentage}>{step.percentage.toFixed(1)}%</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderVariantStats = () => {
    const abTestId = selectedTrialConfig?.abTestId;
    if (!abTestId) {
      return <Text style={styles.emptyText}>No active A/B test for this trial</Text>;
    }

    const assignments = abTestService.getAssignmentsForTest(abTestId);
    const distribution = abTestService.getVariantDistribution(abTestId);
    const stats = useTrialStore.getState().getConversionStats(abTestId);

    return (
      <View style={styles.variantStatsContainer}>
        <Text style={styles.sectionTitle}>A/B Test Results</Text>
        <View style={styles.statsRow}>
          <Card padding="medium" style={styles.statCard}>
            <Text style={styles.statValue}>{stats.totalTrials}</Text>
            <Text style={styles.statLabel}>Total Trials</Text>
          </Card>
          <Card padding="medium" style={styles.statCard}>
            <Text style={styles.statValue}>{(stats.conversionRate * 100).toFixed(1)}%</Text>
            <Text style={styles.statLabel}>Conversion Rate</Text>
          </Card>
        </View>
        <Text style={styles.subsectionTitle}>Variant Distribution</Text>
        {Object.entries(distribution).map(([variant, count]) => (
          <View key={variant} style={styles.distributionRow}>
            <Text style={styles.variantName}>{variant}</Text>
            <View style={styles.distributionBarContainer}>
              <View
                style={[
                  styles.distributionBar,
                  { width: `${(count / stats.totalTrials) * 100}%`, backgroundColor: colors.secondary },
                ]}
              />
            </View>
            <Text style={styles.distributionCount}>{count}</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderReminders = () => {
    const schedule = selectedTrialConfig
      ? reminderScheduler.getByTrialConfigId(selectedTrial.id)
      : undefined;

    if (!schedule) {
      return (
        <Card padding="medium">
          <Text style={styles.emptyText}>No reminders scheduled</Text>
        </Card>
      );
    }

    return (
      <Card padding="medium">
        <Text style={styles.sectionTitle}>Reminder Schedule</Text>
        {schedule.reminders.map((reminder: TrialReminder) => (
          <View key={reminder.id} style={styles.reminderRow}>
            <Text style={styles.reminderType}>{reminder.type}</Text>
            <Text style={styles.reminderStatus}>{reminder.sent ? 'Sent' : 'Pending'}</Text>
            {reminder.message && <Text style={styles.reminderMessage}>{reminder.message}</Text>}
          </View>
        ))}
      </Card>
    );
  };

  return (
    <FormScreen
      title="Free Trial Details"
      subtitle="Manage trial configurations and A/B tests"
      testID="trial-details-screen"
    >
      <ScrollView style={styles.scrollContent}>
        {error && <Text style={styles.errorText}>{error}</Text>}

        {/* Trial Configs List */}
        <Card padding="medium" style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Trial Configurations</Text>
            <Button
              title="New"
              onPress={() => setShowCreateForm(!showCreateForm)}
              variant="secondary"
              size="small"
            />
          </View>
          {trialConfigs.length === 0 ? (
            <Text style={styles.emptyText}>No trial configurations yet</Text>
          ) : (
            trialConfigs.map(renderTrialCard)
          )}
        </Card>

        {/* Create Trial Form */}
        {showCreateForm && (
          <Card padding="medium" style={styles.section}>
            <Text style={styles.sectionTitle}>Create Trial Config</Text>
            <View style={styles.formGroup}>
              <Text style={styles.label}>Subscription ID</Text>
              <TextInput
                style={styles.input}
                value={newTrialConfig.subscriptionId}
                onChangeText={(text) =>
                  setNewTrialConfig((prev) => ({ ...prev, subscriptionId: text }))
                }
                placeholder="Enter subscription ID"
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Duration</Text>
              <View style={styles.pickerContainer}>
                {Object.values(TrialDuration).map((duration) => (
                  <TouchableOpacity
                    key={duration}
                    style={[
                      styles.pickerOption,
                      newTrialConfig.duration === duration && styles.pickerOptionSelected,
                    ]}
                    onPress={() =>
                      setNewTrialConfig((prev) => ({ ...prev, duration }))
                    }
                  >
                    <Text
                      style={[
                        styles.pickerText,
                        newTrialConfig.duration === duration && styles.pickerTextSelected,
                      ]}
                    >
                      {duration.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Feature Access</Text>
              <View style={styles.pickerContainer}>
                {Object.values(TrialFeatureAccess).map((access) => (
                  <TouchableOpacity
                    key={access}
                    style={[
                      styles.pickerOption,
                      newTrialConfig.featureAccess === access && styles.pickerOptionSelected,
                    ]}
                    onPress={() =>
                      setNewTrialConfig((prev) => ({ ...prev, featureAccess: access }))
                    }
                  >
                    <Text
                      style={[
                        styles.pickerText,
                        newTrialConfig.featureAccess === access && styles.pickerTextSelected,
                      ]}
                    >
                      {access.charAt(0).toUpperCase() + access.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Payment Requirement</Text>
              <View style={styles.pickerContainer}>
                {Object.values(PaymentRequirement).map((req) => (
                  <TouchableOpacity
                    key={req}
                    style={[
                      styles.pickerOption,
                      newTrialConfig.paymentRequirement === req && styles.pickerOptionSelected,
                    ]}
                    onPress={() =>
                      setNewTrialConfig((prev) => ({ ...prev, paymentRequirement: req }))
                    }
                  >
                    <Text
                      style={[
                        styles.pickerText,
                        newTrialConfig.paymentRequirement === req && styles.pickerTextSelected,
                      ]}
                    >
                      {req.charAt(0).toUpperCase() + req.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <Button
              title="Create Trial"
              onPress={handleCreateTrial}
              fullWidth
              loading={isLoading}
            />
          </Card>
        )}

        {/* Selected Trial Details */}
        {selectedTrialConfig && (
          <>
            <Card padding="medium" style={styles.section}>
              <Text style={styles.sectionTitle}>Trial Details</Text>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Status</Text>
                {renderStatusBadge(selectedTrialConfig.status)}
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Duration</Text>
                <Text style={styles.detailValue}>{TrialDuration[selectedTrialConfig.duration]}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Feature Access</Text>
                <Text style={styles.detailValue}>
                  {TrialFeatureAccess[selectedTrialConfig.featureAccess]}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Payment</Text>
                <Text style={styles.detailValue}>
                  {PaymentRequirement[selectedTrialConfig.paymentRequirement]}
                </Text>
              </View>
              {selectedTrialConfig.startDate && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Started</Text>
                  <Text style={styles.detailValue}>
                    {new Date(selectedTrialConfig.startDate).toLocaleDateString()}
                  </Text>
                </View>
              )}
              {selectedTrialConfig.endDate && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Ends</Text>
                  <Text style={styles.detailValue}>
                    {new Date(selectedTrialConfig.endDate).toLocaleDateString()}
                  </Text>
                </View>
              )}

              <View style={styles.actionButtons}>
                {selectedTrialConfig.status === TrialStatus.ACTIVE && (
                  <>
                    <Button
                      title="Convert Trial"
                      onPress={() => handleConvertTrial(selectedTrialConfig.id)}
                      variant="primary"
                      size="medium"
                      style={styles.actionButton}
                    />
                    <Button
                      title="Expire Trial"
                      onPress={() => handleExpireTrial(selectedTrialConfig.id)}
                      variant="danger"
                      size="medium"
                      style={styles.actionButton}
                    />
                  </>
                )}
              </View>
            </Card>

            {/* Reminders */}
            {renderReminders()}

            {/* Conversion Funnel */}
            <Card padding="medium" style={styles.section}>
              <Text style={styles.sectionTitle}>Conversion Funnel</Text>
              {renderFunnelChart(getFunnelSteps(selectedTrialConfig.id))}
            </Card>

            {/* A/B Test Stats */}
            {renderVariantStats()}
          </>
        )}
      </ScrollView>
    </FormScreen>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    scrollContent: {
      flex: 1,
    },
    section: {
      marginBottom: spacing.lg,
    },
    errorText: {
      color: colors.error || '#ef4444',
      marginBottom: spacing.md,
      ...typography.body,
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    sectionTitle: {
      ...typography.h3,
      color: colors.text,
      marginBottom: spacing.md,
    },
    subsectionTitle: {
      ...typography.body,
      color: colors.textSecondary || '#cbd5e1',
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      fontWeight: '600',
    },
    trialCard: {
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border?.default || '#334155',
      backgroundColor: colors.surface || '#1e293b',
    },
    trialCardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.xs,
    },
    trialCardTitle: {
      ...typography.body,
      color: colors.text,
      fontWeight: '600',
    },
    trialCardMeta: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    trialCardMetaText: {
      ...typography.caption,
      color: colors.textSecondary || '#cbd5e1',
    },
    abTestTag: {
      marginTop: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs / 2,
      borderRadius: borderRadius.sm,
      backgroundColor: colors.accent || '#06b6d4',
      alignSelf: 'flex-start',
    },
    abTestText: {
      ...typography.caption,
      color: colors.background || '#0f172a',
      fontWeight: '600',
    },
    statusBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs / 2,
      borderRadius: borderRadius.sm,
    },
    statusText: {
      ...typography.caption,
      fontWeight: '600',
    },
    formGroup: {
      marginBottom: spacing.md,
    },
    label: {
      ...typography.body,
      color: colors.text,
      marginBottom: spacing.xs,
      fontWeight: '500',
    },
    input: {
      ...typography.body,
      backgroundColor: colors.surface || '#1e293b',
      padding: spacing.md,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border?.default || '#334155',
      color: colors.text,
    },
    pickerContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    pickerOption: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.md,
      backgroundColor: colors.surface || '#1e293b',
      borderWidth: 1,
      borderColor: colors.border?.default || '#334155',
    },
    pickerOptionSelected: {
      backgroundColor: colors.brand?.primary || '#6366f1',
      borderColor: colors.brand?.primary || '#6366f1',
    },
    pickerText: {
      ...typography.caption,
      color: colors.text,
    },
    pickerTextSelected: {
      color: colors.onPrimary || '#ffffff',
      fontWeight: '600',
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border?.default || '#334155',
    },
    detailLabel: {
      ...typography.body,
      color: colors.textSecondary || '#cbd5e1',
    },
    detailValue: {
      ...typography.body,
      color: colors.text,
      fontWeight: '500',
      textTransform: 'capitalize',
    },
    actionButtons: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    actionButton: {
      flex: 1,
    },
    emptyText: {
      ...typography.body,
      color: colors.textSecondary || '#cbd5e1',
      textAlign: 'center',
      paddingVertical: spacing.lg,
    },
    funnelContainer: {
      gap: spacing.md,
    },
    funnelStep: {
      marginBottom: spacing.sm,
    },
    funnelStepHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.xs,
    },
    funnelStepLabel: {
      ...typography.body,
      color: colors.text,
      fontWeight: '500',
      textTransform: 'capitalize',
    },
    funnelStepCount: {
      ...typography.body,
      color: colors.text,
      fontWeight: '600',
    },
    funnelBarContainer: {
      height: 12,
      borderRadius: borderRadius.sm,
      backgroundColor: colors.border?.default || '#334155',
      overflow: 'hidden',
    },
    funnelBar: {
      height: '100%',
      borderRadius: borderRadius.sm,
    },
    funnelPercentage: {
      ...typography.caption,
      color: colors.textSecondary || '#cbd5e1',
      marginTop: spacing.xs,
    },
    variantStatsContainer: {
      marginTop: spacing.md,
    },
    statsRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    statCard: {
      flex: 1,
      alignItems: 'center',
    },
    statValue: {
      ...typography.h2,
      color: colors.text,
      fontWeight: '700',
    },
    statLabel: {
      ...typography.caption,
      color: colors.textSecondary || '#cbd5e1',
      textAlign: 'center',
    },
    distributionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.sm,
      gap: spacing.sm,
    },
    variantName: {
      ...typography.caption,
      color: colors.text,
      width: 80,
      fontWeight: '500',
    },
    distributionBarContainer: {
      flex: 1,
      height: 8,
      borderRadius: borderRadius.sm,
      backgroundColor: colors.border?.default || '#334155',
      overflow: 'hidden',
    },
    distributionBar: {
      height: '100%',
      borderRadius: borderRadius.sm,
    },
    distributionCount: {
      ...typography.caption,
      color: colors.text,
      width: 30,
      textAlign: 'right',
    },
    reminderRow: {
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border?.default || '#334155',
    },
    reminderType: {
      ...typography.body,
      color: colors.text,
      fontWeight: '600',
    },
    reminderStatus: {
      ...typography.caption,
      color: colors.textSecondary || '#cbd5e1',
      marginLeft: spacing.sm,
    },
    reminderMessage: {
      ...typography.caption,
      color: colors.textSecondary || '#cbd5e1',
      marginTop: spacing.xs,
    },
  });
}

export default TrialDetailsScreen;
