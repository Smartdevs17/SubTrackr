import React, { useCallback, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { FormScreen } from '../components/common/ScreenTemplates';
import { usePauseStore } from '../store/pauseStore';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { PauseReason, DEFAULT_PAUSE_LIMITS } from '../types/pause';
import type { RootStackParamList } from '../navigation/types';
import { colors, spacing, typography } from '../utils/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = NativeStackScreenProps<RootStackParamList, 'PauseSubscription'>;

// ---------------------------------------------------------------------------
// Duration selector
// ---------------------------------------------------------------------------

const DURATION_OPTIONS = [7, 14, 30, 60, 90];

interface DurationSelectorProps {
  selected: number;
  onSelect: (days: number) => void;
}

const DurationSelector: React.FC<DurationSelectorProps> = ({ selected, onSelect }) => (
  <View style={styles.durationRow} accessibilityRole="radiogroup">
    {DURATION_OPTIONS.map((days) => (
      <TouchableOpacity
        key={days}
        style={[styles.durationChip, selected === days && styles.durationChipActive]}
        onPress={() => onSelect(days)}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected === days }}
        accessibilityLabel={`${days} days`}>
        <Text style={[styles.durationChipText, selected === days && styles.durationChipTextActive]}>
          {days}d
        </Text>
      </TouchableOpacity>
    ))}
  </View>
);

// ---------------------------------------------------------------------------
// Reason selector
// ---------------------------------------------------------------------------

const REASON_LABELS: Record<PauseReason, string> = {
  [PauseReason.VACATION]: '🏖  Vacation',
  [PauseReason.FINANCIAL_HARDSHIP]: '💰  Financial hardship',
  [PauseReason.TEMPORARY_NEED]: '⏸  Temporary need',
  [PauseReason.OTHER]: '❓  Other',
};

interface ReasonSelectorProps {
  selected: PauseReason;
  onSelect: (reason: PauseReason) => void;
}

const ReasonSelector: React.FC<ReasonSelectorProps> = ({ selected, onSelect }) => (
  <View accessibilityRole="radiogroup">
    {(Object.values(PauseReason) as PauseReason[]).map((reason) => (
      <TouchableOpacity
        key={reason}
        style={[styles.reasonRow, selected === reason && styles.reasonRowActive]}
        onPress={() => onSelect(reason)}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected === reason }}
        accessibilityLabel={REASON_LABELS[reason]}>
        <Text style={[styles.reasonText, selected === reason && styles.reasonTextActive]}>
          {REASON_LABELS[reason]}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
);

// ---------------------------------------------------------------------------
// Active-pause card
// ---------------------------------------------------------------------------

interface ActivePauseCardProps {
  subscriptionName: string;
  resumeDate: Date;
  creditRemaining: number;
  currency: string;
  onResume: () => void;
}

const ActivePauseCard: React.FC<ActivePauseCardProps> = ({
  subscriptionName,
  resumeDate,
  creditRemaining,
  currency,
  onResume,
}) => {
  const daysLeft = Math.max(
    0,
    Math.ceil((resumeDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  );

  return (
    <Card style={styles.activePauseCard}>
      <Text style={styles.activePauseTitle} accessibilityRole="header">
        ⏸ {subscriptionName} is paused
      </Text>
      <Text style={styles.meta}>
        Resumes in {daysLeft} day{daysLeft !== 1 ? 's' : ''} —{' '}
        {resumeDate.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}
      </Text>
      <Text style={styles.meta}>
        Credit remaining: {currency} {creditRemaining.toFixed(2)}
      </Text>
      <View style={styles.actions}>
        <Button
          title="Resume Early"
          onPress={onResume}
          accessibilityLabel="Resume subscription early"
        />
      </View>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

const PauseSubscriptionScreen: React.FC<Props> = ({ route }) => {
  const subscriptionId = route.params?.subscriptionId;

  const { subscriptions } = useSubscriptionStore();
  const {
    pauseSubscription,
    resumeSubscription,
    getActivePause,
    getPauseHistory,
    previewPause,
    error,
  } = usePauseStore();

  const subscription = useMemo(
    () => subscriptions.find((s) => s.id === subscriptionId),
    [subscriptions, subscriptionId]
  );

  const activePause = subscriptionId ? getActivePause(subscriptionId) : undefined;
  const history = subscriptionId ? getPauseHistory(subscriptionId) : [];
  const completedPauses = history.filter((r) => r.state !== 'paused');

  const [pauseDays, setPauseDays] = useState(30);
  const [reason, setReason] = useState<PauseReason>(PauseReason.VACATION);

  const preview = useMemo(() => {
    if (!subscription) return null;
    return previewPause(subscription, pauseDays);
  }, [subscription, pauseDays, previewPause]);

  const validation = useMemo(() => {
    if (!subscriptionId) return { valid: false, reason: 'No subscription selected.' };
    const store = usePauseStore.getState();
    return store.validatePause(subscriptionId, pauseDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriptionId, pauseDays]);

  const handlePause = useCallback(() => {
    if (!subscription) return;
    if (!validation.valid) {
      Alert.alert('Cannot pause', validation.reason ?? 'Validation failed.');
      return;
    }
    Alert.alert(
      'Confirm Pause',
      `Pause "${subscription.name}" for ${pauseDays} days?\n\nYou'll receive a credit of ${subscription.currency} ${preview?.creditAmount.toFixed(2) ?? '0.00'} for the unused period.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Pause',
          onPress: () => {
            try {
              pauseSubscription(subscription, pauseDays, reason, DEFAULT_PAUSE_LIMITS);
            } catch (e) {
              Alert.alert('Error', (e as Error).message);
            }
          },
        },
      ]
    );
  }, [subscription, pauseDays, reason, preview, validation, pauseSubscription]);

  const handleResume = useCallback(() => {
    if (!subscriptionId) return;
    Alert.alert(
      'Resume Early',
      'Resume now? Any unused pause credit will be applied to your next charge.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Resume',
          onPress: () => {
            const result = resumeSubscription(subscriptionId, true);
            if (!result) Alert.alert('Error', 'Could not resume subscription.');
          },
        },
      ]
    );
  }, [subscriptionId, resumeSubscription]);

  if (!subscription) {
    return (
      <FormScreen
        title="Pause Subscription"
        subtitle="Subscription not found"
        analyticsName="PauseSubscription"
        testID="pause-subscription-screen">
        <Text style={styles.notFound}>Subscription not found.</Text>
      </FormScreen>
    );
  }

  return (
    <FormScreen
      title="Pause Subscription"
      subtitle="Take a break without losing your account history"
      analyticsName="PauseSubscription"
      error={error}
      testID="pause-subscription-screen">
      {/* Active pause state */}
      {activePause ? (
        <ActivePauseCard
          subscriptionName={subscription.name}
          resumeDate={new Date(activePause.scheduledResumeAt)}
          creditRemaining={activePause.creditRemaining}
          currency={activePause.currency}
          onResume={handleResume}
        />
      ) : (
        <>
          {/* Subscription summary */}
          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>{subscription.name}</Text>
            <Text style={styles.meta}>
              {subscription.currency} {subscription.price.toFixed(2)} / {subscription.billingCycle}
            </Text>
            <Text style={styles.meta}>
              Next billing: {new Date(subscription.nextBillingDate).toLocaleDateString()}
            </Text>
          </Card>

          {/* Duration */}
          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>Pause Duration</Text>
            <Text style={styles.meta}>Select how many days to pause (7–90 days)</Text>
            <DurationSelector selected={pauseDays} onSelect={setPauseDays} />
          </Card>

          {/* Reason */}
          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>Reason</Text>
            <ReasonSelector selected={reason} onSelect={setReason} />
          </Card>

          {/* Credit preview */}
          {preview ? (
            <Card style={styles.previewCard}>
              <Text style={styles.sectionTitle}>Credit Preview</Text>
              <Text style={styles.meta}>
                You'll receive a credit of{' '}
                <Text style={styles.highlight}>
                  {preview.currency} {preview.creditAmount.toFixed(2)}
                </Text>{' '}
                for the {pauseDays}-day pause.
              </Text>
              <Text style={styles.meta}>
                Scheduled resume:{' '}
                {preview.scheduledResumeAt.toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </Text>
              <Text style={styles.note}>
                ℹ️ No billing or usage accrual during pause. Data and settings are preserved.
              </Text>
              {!validation.valid ? (
                <Text style={styles.validationError}>{validation.reason}</Text>
              ) : null}
            </Card>
          ) : null}

          <Button
            title={`Pause for ${pauseDays} Days`}
            onPress={handlePause}
            disabled={!validation.valid}
            accessibilityLabel={`Pause subscription for ${pauseDays} days`}
          />
        </>
      )}

      {/* Pause history */}
      {completedPauses.length > 0 ? (
        <Card style={styles.historyCard}>
          <Text style={styles.sectionTitle}>Pause History (this year)</Text>
          {completedPauses.map((record) => (
            <View key={record.id} style={styles.historyRow}>
              <Text style={styles.meta}>
                {new Date(record.pausedAt).toLocaleDateString()} →{' '}
                {record.resumedAt
                  ? new Date(record.resumedAt).toLocaleDateString()
                  : new Date(record.scheduledResumeAt).toLocaleDateString()}
              </Text>
              <Text style={styles.meta}>
                Credit: {record.currency} {record.creditAmount.toFixed(2)}
                {record.creditExpired ? ' (expired)' : ''}
              </Text>
            </View>
          ))}
          <Text style={styles.limitNote}>
            {completedPauses.length}/{DEFAULT_PAUSE_LIMITS.maxPausesPerYear} pauses used this year
          </Text>
        </Card>
      ) : null}
    </FormScreen>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },
  previewCard: {
    marginBottom: spacing.md,
    borderColor: colors.primary,
    borderWidth: 1,
  },
  historyCard: {
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  activePauseCard: {
    marginBottom: spacing.md,
    borderColor: colors.warning,
    borderWidth: 1,
  },
  activePauseTitle: {
    ...typography.h3,
    color: colors.warning,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  meta: {
    ...typography.body2,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  highlight: {
    color: colors.primary,
    fontWeight: '600',
  },
  note: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  validationError: {
    ...typography.body2,
    color: colors.error,
    marginTop: spacing.sm,
  },
  actions: {
    marginTop: spacing.md,
  },
  durationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  durationChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  durationChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  durationChipText: {
    ...typography.body2,
    color: colors.textSecondary,
  },
  durationChipTextActive: {
    color: colors.onPrimary,
    fontWeight: '600',
  },
  reasonRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    marginBottom: spacing.xs,
    backgroundColor: colors.surface,
  },
  reasonRowActive: {
    backgroundColor: colors.surfaceVariant,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  reasonText: {
    ...typography.body2,
    color: colors.textSecondary,
  },
  reasonTextActive: {
    color: colors.text,
    fontWeight: '600',
  },
  historyRow: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  limitNote: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  notFound: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});

export default PauseSubscriptionScreen;
