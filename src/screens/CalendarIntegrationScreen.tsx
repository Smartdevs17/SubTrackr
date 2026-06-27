import React, { useEffect, useCallback } from 'react';
import {
  Alert,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { Card } from '../components/common/Card';
import { useCalendarStore, useSubscriptionStore } from '../store';
import {
  CALENDAR_PROVIDERS,
  REMINDER_OFFSET_OPTIONS,
  REMINDER_PRESETS,
  SUBSCRIPTION_TIMEZONES,
  type CalendarProvider,
} from '../types/calendar';
import { borderRadius, colors, spacing, typography } from '../utils/constants';

const providerLabels: Record<CalendarProvider, string> = {
  google: 'Google Calendar',
  apple: 'Apple Calendar',
  outlook: 'Outlook Calendar',
};

const providerDescriptions: Record<CalendarProvider, string> = {
  google: 'Sync renewal reminders into your primary Google calendar.',
  apple: 'Add subscription events to the iCloud calendar linked to your Apple ID.',
  outlook: 'Push billing reminders into Outlook and Microsoft 365 calendars.',
};

const formatReminderOffset = (offset: number): string => {
  if (offset % (24 * 60) === 0) return `${offset / (24 * 60)}d`;
  if (offset % 60 === 0) return `${offset / 60}h`;
  return `${offset}m`;
};

const formatReminderSummary = (offsets: number[]): string => {
  if (offsets.length === 0) return 'No calendar alerts';
  return offsets.map(formatReminderOffset).join(', ');
};

const CalendarIntegrationScreen: React.FC = () => {
  const {
    integrations,
    syncedEvents,
    pendingAuthorizations,
    reminderOffsets,
    error,
    oneTimePayments,
    scheduleConflicts,
    timezone,
    beginConnection,
    completeConnection,
    cancelConnection,
    disconnectConnection,
    setReminderOffsets,
    toggleReminderOffset,
    clearError,
    addOneTimePayment,
    cancelOneTimePayment,
    checkConflicts,
    exportCalendar,
    setTimezone,
  } = useCalendarStore();
  const subscriptions = useSubscriptionStore((state) => state.subscriptions);

  const activeSubscriptions = subscriptions.filter((subscription) => subscription.isActive);
  const previewEvent = syncedEvents[0];

  useEffect(() => {
    let isMounted = true;

    const syncSubscriptions = async () => {
      await useCalendarStore
        .getState()
        .syncSubscriptions(useSubscriptionStore.getState().subscriptions);
    };

    const processRedirect = async (redirectUrl: string | null | undefined) => {
      if (!redirectUrl) return;

      try {
        const integration = await useCalendarStore.getState().handleOAuthRedirect(redirectUrl);
        if (!integration || !isMounted) return;

        await syncSubscriptions();
        Alert.alert(
          'Calendar connected',
          `${providerLabels[integration.provider]} is now syncing billing reminders.`
        );
      } catch (connectError) {
        if (!isMounted) return;

        const message =
          connectError instanceof Error ? connectError.message : 'Failed to connect calendar.';
        Alert.alert('Connection failed', message);
      }
    };

    void Linking.getInitialURL().then((initialUrl) => {
      void processRedirect(initialUrl);
    });

    const subscription = Linking.addEventListener('url', ({ url }) => {
      void processRedirect(url);
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  const syncAllSubscriptions = async () => {
    await useCalendarStore
      .getState()
      .syncSubscriptions(useSubscriptionStore.getState().subscriptions);
  };

  const handleExportICal = useCallback(async () => {
    try {
      const payload = exportCalendar(subscriptions, timezone);
      await Share.share({
        message: payload.ical,
        title: payload.filename,
      });
      Alert.alert('Calendar exported', `Exported ${payload.events.length} events to ${payload.filename}`);
    } catch (exportError) {
      Alert.alert('Export failed', exportError instanceof Error ? exportError.message : 'Could not export calendar.');
    }
  }, [subscriptions, timezone, exportCalendar]);

  const handleCheckConflicts = useCallback(() => {
    checkConflicts(subscriptions);
  }, [subscriptions, checkConflicts]);

  const handleScheduleOneTimePayment = useCallback(() => {
    Alert.prompt
      ? Alert.prompt(
          'Schedule one-time payment',
          'Enter subscription ID and amount (e.g., sub-1,29.99)',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Schedule',
              onPress: (input?: string) => {
                if (!input) return;
                const [subId, amountStr] = input.split(',');
                const amount = parseFloat(amountStr);
                if (subId && !isNaN(amount)) {
                  addOneTimePayment(subId, amount, 'USD', new Date(), 'One-time payment');
                  Alert.alert('Scheduled', `One-time payment of ${amount} USD for ${subId}`);
                }
              },
            },
          ],
          'plain-text'
        )
      : Alert.alert(
          'Schedule one-time payment',
          'Use the calendar app to schedule one-time payments from the billing screen.'
        );
  }, [addOneTimePayment]);

  const handleConnect = async (provider: CalendarProvider) => {
    try {
      const authorization = await beginConnection(provider);
      const canOpen = await Linking.canOpenURL(authorization.authorizationUrl);

      if (!canOpen) {
        throw new Error(`Unable to open the ${providerLabels[provider]} authorization page.`);
      }

      await Linking.openURL(authorization.authorizationUrl);
      Alert.alert(
        'Authorization started',
        `Approve access in ${providerLabels[provider]}, then return to SubTrackr. If your device does not redirect automatically, tap Finish connection from the provider row.`
      );
    } catch (connectError) {
      const message =
        connectError instanceof Error ? connectError.message : 'Failed to connect calendar.';
      Alert.alert('Connection failed', message);
    }
  };

  const finishConnection = async (provider: CalendarProvider) => {
    try {
      const integration = await completeConnection(provider);
      await syncAllSubscriptions();
      Alert.alert(
        'Calendar connected',
        `${providerLabels[integration.provider]} is now syncing billing reminders.`
      );
    } catch (connectError) {
      const message =
        connectError instanceof Error ? connectError.message : 'Failed to connect calendar.';
      Alert.alert('Connection failed', message);
    }
  };

  const handleDisconnect = (connectionId: string, provider: CalendarProvider) => {
    Alert.alert('Disconnect calendar', `Remove ${providerLabels[provider]} from calendar sync?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          try {
            await disconnectConnection(connectionId);
            Alert.alert(
              'Calendar disconnected',
              `${providerLabels[provider]} has been removed from sync.`
            );
          } catch (disconnectError) {
            const message =
              disconnectError instanceof Error
                ? disconnectError.message
                : 'Failed to disconnect calendar.';
            Alert.alert('Disconnect failed', message);
          }
        },
      },
    ]);
  };

  const handleReminderPreset = async (offsets: number[]) => {
    setReminderOffsets(offsets);
    await syncAllSubscriptions();
  };

  const handleReminderToggle = async (offset: number) => {
    toggleReminderOffset(offset);
    await syncAllSubscriptions();
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Calendar Integrations</Text>
          <Text style={styles.subtitle}>
            Connect Google, Apple, or Outlook calendars to keep subscription renewals and billing
            reminders in your personal schedule.
          </Text>
        </View>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Providers</Text>
          {CALENDAR_PROVIDERS.map((provider) => {
            const integration = integrations.find((entry) => entry.provider === provider);
            const pending = pendingAuthorizations[provider];
            const syncedCount = integration
              ? syncedEvents.filter((event) => event.connectionId === integration.id).length
              : 0;

            return (
              <View key={provider} style={styles.providerCard}>
                <View style={styles.providerInfo}>
                  <Text style={styles.providerLabel}>{providerLabels[provider]}</Text>
                  <Text style={styles.providerDescription}>{providerDescriptions[provider]}</Text>
                  <Text style={styles.providerMeta}>
                    {integration
                      ? `${integration.accountEmail} - ${syncedCount} synced events - ${formatReminderSummary(
                          integration.reminderOffsets
                        )}`
                      : pending
                        ? 'Awaiting authorization callback'
                        : 'Not connected'}
                  </Text>
                  {integration?.lastSyncedAt ? (
                    <Text style={styles.providerMeta}>
                      Last sync {new Date(integration.lastSyncedAt).toLocaleString()}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.providerActions}>
                  {integration ? (
                    <TouchableOpacity
                      style={[styles.actionButton, styles.disconnectButton]}
                      onPress={() => handleDisconnect(integration.id, provider)}>
                      <Text style={styles.actionButtonText}>Disconnect</Text>
                    </TouchableOpacity>
                  ) : pending ? (
                    <>
                      <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => {
                          void finishConnection(provider);
                        }}>
                        <Text style={styles.actionButtonText}>Finish connection</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionButton, styles.secondaryButton]}
                        onPress={() => cancelConnection(provider)}>
                        <Text style={styles.secondaryButtonText}>Cancel</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => {
                        void handleConnect(provider);
                      }}>
                      <Text style={styles.actionButtonText}>Connect</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })}
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Reminder customization</Text>
          <Text style={styles.sectionDescription}>
            Choose a preset, then fine-tune exactly when calendar alerts fire before each renewal.
          </Text>

          <View style={styles.presetGrid}>
            {REMINDER_PRESETS.map((preset) => {
              const selected =
                preset.offsets.length === reminderOffsets.length &&
                preset.offsets.every((offset, index) => reminderOffsets[index] === offset);

              return (
                <TouchableOpacity
                  key={preset.label}
                  style={[styles.presetButton, selected && styles.presetButtonActive]}
                  onPress={() => {
                    void handleReminderPreset(preset.offsets);
                  }}>
                  <Text style={[styles.presetLabel, selected && styles.presetLabelActive]}>
                    {preset.label}
                  </Text>
                  <Text style={[styles.presetMeta, selected && styles.presetLabelActive]}>
                    {formatReminderSummary(preset.offsets)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.offsetGrid}>
            {REMINDER_OFFSET_OPTIONS.map((option) => {
              const selected = reminderOffsets.includes(option.offset);
              return (
                <TouchableOpacity
                  key={option.offset}
                  style={[styles.offsetChip, selected && styles.offsetChipActive]}
                  onPress={() => {
                    void handleReminderToggle(option.offset);
                  }}>
                  <Text style={[styles.offsetChipText, selected && styles.offsetChipTextActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.currentReminderText}>
            Current alerts: {formatReminderSummary(reminderOffsets)}
          </Text>
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Sync coverage</Text>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Active subscriptions</Text>
            <Text style={styles.metricValue}>{activeSubscriptions.length}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Connected providers</Text>
            <Text style={styles.metricValue}>{integrations.length}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Pending authorizations</Text>
            <Text style={styles.metricValue}>{Object.keys(pendingAuthorizations).length}</Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>Synced events</Text>
            <Text style={styles.metricValue}>{syncedEvents.length}</Text>
          </View>

          {previewEvent ? (
            <View style={styles.previewCard}>
              <Text style={styles.previewTitle}>{previewEvent.title}</Text>
              <Text style={styles.previewBody}>{previewEvent.notes}</Text>
              <Text style={styles.previewMeta}>
                Starts {new Date(previewEvent.startAt).toLocaleString()}
              </Text>
              <Text style={styles.previewMeta}>
                Alerts {formatReminderSummary(previewEvent.reminderOffsets)}
              </Text>
            </View>
          ) : (
            <Text style={styles.emptyPreview}>
              Connect a provider to start generating renewal events from active subscriptions.
            </Text>
          )}
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Calendar export</Text>
          <Text style={styles.sectionDescription}>
            Export all subscription renewal events as an iCal file for use with any calendar app.
          </Text>
          <TouchableOpacity style={styles.actionButton} onPress={handleExportICal}>
            <Text style={styles.actionButtonText}>Export iCal (.ics)</Text>
          </TouchableOpacity>
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Timezone</Text>
          <Text style={styles.sectionDescription}>
            Set your preferred timezone for calendar events. Current: {timezone}.
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.timezoneScroll}>
            {SUBSCRIPTION_TIMEZONES.map((tz) => (
              <TouchableOpacity
                key={tz}
                style={[styles.timezoneChip, tz === timezone && styles.offsetChipActive]}
                onPress={() => setTimezone(tz)}>
                <Text style={[styles.offsetChipText, tz === timezone && styles.offsetChipTextActive]}>
                  {tz}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Schedule conflicts</Text>
          <Text style={styles.sectionDescription}>
            Detect overlapping subscription billing dates and total charges per day.
          </Text>
          <TouchableOpacity style={styles.actionButton} onPress={handleCheckConflicts}>
            <Text style={styles.actionButtonText}>Check for conflicts</Text>
          </TouchableOpacity>
          {scheduleConflicts.length > 0 ? (
            scheduleConflicts.slice(0, 5).map((conflict) => (
              <View key={conflict.date} style={styles.conflictRow}>
                <Text style={styles.conflictDate}>{conflict.date}</Text>
                <Text style={styles.conflictDetail}>
                  {conflict.conflictingSubscriptions.length} subscriptions — {conflict.totalAmount.toFixed(2)} USD total
                </Text>
                {conflict.conflictingSubscriptions.map((sub) => (
                  <Text key={sub.id} style={styles.conflictSub}>
                    {sub.name}: {sub.currency} {sub.amount.toFixed(2)}
                  </Text>
                ))}
              </View>
            ))
          ) : scheduleConflicts.length === 0 && (
            <Text style={styles.emptyPreview}>No conflicts detected. Tap "Check for conflicts" to scan.</Text>
          )}
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>One-time payments</Text>
          <Text style={styles.sectionDescription}>
            Schedule one-time payments beyond recurring subscriptions.
          </Text>
          <TouchableOpacity style={styles.actionButton} onPress={handleScheduleOneTimePayment}>
            <Text style={styles.actionButtonText}>Schedule payment</Text>
          </TouchableOpacity>
          {oneTimePayments.length > 0 ? (
            oneTimePayments.map((payment) => (
              <View key={payment.id} style={styles.conflictRow}>
                <Text style={styles.conflictDate}>{payment.description}</Text>
                <Text style={styles.conflictDetail}>
                  {payment.currency} {payment.amount.toFixed(2)} — {payment.status}
                </Text>
                <Text style={styles.conflictSub}>{new Date(payment.scheduledDate).toLocaleDateString()}</Text>
                {payment.status === 'pending' && (
                  <TouchableOpacity
                    style={[styles.actionButton, styles.disconnectButton]}
                    onPress={() => cancelOneTimePayment(payment.id)}>
                    <Text style={styles.actionButtonText}>Cancel</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))
          ) : (
            <Text style={styles.emptyPreview}>No one-time payments scheduled.</Text>
          )}
        </Card>

        {error ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.errorButton} onPress={clearError}>
              <Text style={styles.errorButtonText}>Dismiss</Text>
            </TouchableOpacity>
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  header: { marginBottom: spacing.sm },
  title: { ...typography.h1, color: colors.text, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary },
  section: { padding: spacing.lg },
  sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.sm },
  sectionDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  providerCard: {
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  providerInfo: { gap: spacing.xs },
  providerLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
  providerDescription: { ...typography.caption, color: colors.textSecondary },
  providerMeta: { ...typography.small, color: colors.textSecondary },
  providerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actionButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },
  secondaryButton: {
    backgroundColor: colors.surfaceVariant,
    borderWidth: 1,
    borderColor: colors.border,
  },
  disconnectButton: { backgroundColor: colors.error },
  actionButtonText: { ...typography.caption, color: colors.text, fontWeight: '700' },
  secondaryButtonText: { ...typography.caption, color: colors.text, fontWeight: '600' },
  presetGrid: { gap: spacing.sm },
  presetButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  presetButtonActive: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}20`,
  },
  presetLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
  presetLabelActive: { color: colors.text },
  presetMeta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  offsetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  offsetChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  offsetChipActive: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}22`,
  },
  offsetChipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  offsetChipTextActive: { color: colors.text },
  currentReminderText: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  metricLabel: { ...typography.body, color: colors.textSecondary },
  metricValue: { ...typography.h3, color: colors.text },
  previewCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    backgroundColor: `${colors.primary}14`,
    borderWidth: 1,
    borderColor: `${colors.primary}33`,
  },
  previewTitle: { ...typography.body, color: colors.text, fontWeight: '700' },
  previewBody: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm },
  previewMeta: { ...typography.small, color: colors.textSecondary, marginTop: spacing.xs },
  emptyPreview: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm },
  errorCard: {
    borderWidth: 1,
    borderColor: `${colors.error}66`,
    backgroundColor: `${colors.error}12`,
    gap: spacing.md,
  },
  errorText: { ...typography.caption, color: colors.error },
  errorButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: `${colors.error}66`,
  },
  errorButtonText: { ...typography.caption, color: colors.error, fontWeight: '600' },
  timezoneScroll: { marginTop: spacing.sm },
  timezoneChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
  },
  conflictRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.xs,
  },
  conflictDate: { ...typography.body, color: colors.text, fontWeight: '600' },
  conflictDetail: { ...typography.caption, color: colors.textSecondary },
  conflictSub: { ...typography.small, color: colors.textSecondary, paddingLeft: spacing.sm },
});

export default CalendarIntegrationScreen;
