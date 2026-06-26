import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TextInput,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Card } from '../components/common/Card';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import {
  defaultRetryPolicy,
  useWebhookStore,
  webhookEventTypes,
  webhookStatusLabels,
} from '../store/webhookStore';
import { WebhookConfig, WebhookEventType } from '../types/webhook';

const emptyWebhookForm = {
  merchantId: '',
  url: '',
  secretKey: '',
};

const WebhookSettingsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const {
    webhooks,
    deliveries,
    analytics,
    registerWebhook,
    updateWebhook,
    deleteWebhook,
    pauseWebhook,
    resumeWebhook,
    retryDelivery,
    sendTestEvent,
    refreshAnalytics,
  } = useWebhookStore();

  const [form, setForm] = useState(emptyWebhookForm);
  const [selectedEvents, setSelectedEvents] = useState<WebhookEventType[]>([
    'subscription.created',
    'subscription.renewed',
    'subscription.cancelled',
  ]);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    refreshAnalytics();
  }, [deliveries.length, refreshAnalytics]);

  const resetForm = () => {
    setForm(emptyWebhookForm);
    setSelectedEvents(['subscription.created', 'subscription.renewed', 'subscription.cancelled']);
    setEditingId(null);
  };

  const handleSubmit = async () => {
    if (!form.merchantId || !form.url || !form.secretKey) {
      Alert.alert('Missing fields', 'Merchant, endpoint URL, and secret key are required.');
      return;
    }

    if (selectedEvents.length === 0) {
      Alert.alert('Select events', 'Choose at least one lifecycle event.');
      return;
    }

    if (editingId) {
      await updateWebhook(editingId, {
        merchantId: form.merchantId,
        url: form.url,
        secretKey: form.secretKey,
        events: selectedEvents,
        retryPolicy: defaultRetryPolicy,
      } as Partial<WebhookConfig>);
      resetForm();
      return;
    }

    await registerWebhook({
      merchantId: form.merchantId,
      url: form.url,
      secretKey: form.secretKey,
      events: selectedEvents,
      retryPolicy: defaultRetryPolicy,
      isPaused: false,
    });
    resetForm();
  };

  const toggleEvent = (eventType: WebhookEventType) => {
    setSelectedEvents((current) =>
      current.includes(eventType)
        ? current.filter((item) => item !== eventType)
        : [...current, eventType]
    );
  };

  const startEdit = (webhook: WebhookConfig) => {
    setEditingId(webhook.id);
    setForm({
      merchantId: webhook.merchantId,
      url: webhook.url,
      secretKey: webhook.secretKey,
    });
    setSelectedEvents(webhook.events);
  };

  const onDelete = (id: string) => {
    Alert.alert('Delete webhook', 'Remove this webhook configuration?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteWebhook(id) },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Webhooks</Text>
          <Text style={styles.subtitle}>Manage subscription lifecycle notifications</Text>
        </View>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Webhook configuration</Text>
          <TextInput
            value={form.merchantId}
            onChangeText={(merchantId) => setForm((state) => ({ ...state, merchantId }))}
            placeholder="Merchant ID"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
          />
          <TextInput
            value={form.url}
            onChangeText={(url) => setForm((state) => ({ ...state, url }))}
            placeholder="https://example.com/webhooks/subscriptions"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            keyboardType="url"
            style={styles.input}
          />
          <TextInput
            value={form.secretKey}
            onChangeText={(secretKey) => setForm((state) => ({ ...state, secretKey }))}
            placeholder="Signing secret"
            placeholderTextColor={colors.textSecondary}
            secureTextEntry
            style={styles.input}
          />

          <Text style={styles.subsectionTitle}>Events</Text>
          <View style={styles.eventGrid}>
            {webhookEventTypes.map((eventType) => {
              const active = selectedEvents.includes(eventType);
              return (
                <TouchableOpacity
                  key={eventType}
                  style={[styles.eventChip, active && styles.eventChipActive]}
                  onPress={() => toggleEvent(eventType)}>
                  <Text style={[styles.eventChipText, active && styles.eventChipTextActive]}>
                    {eventType}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity style={styles.primaryButton} onPress={handleSubmit}>
            <Text style={styles.primaryButtonText}>
              {editingId ? 'Update webhook' : 'Register webhook'}
            </Text>
          </TouchableOpacity>
          {editingId ? (
            <TouchableOpacity style={styles.secondaryButton} onPress={resetForm}>
              <Text style={styles.secondaryButtonText}>Cancel edit</Text>
            </TouchableOpacity>
          ) : null}
        </Card>

        {webhooks.map((webhook) => {
          const webhookAnalytics = analytics[webhook.id];
          const latestDeliveries = deliveries
            .filter((delivery) => delivery.webhookId === webhook.id)
            .slice(-3)
            .reverse();

          return (
            <Card key={webhook.id} style={styles.section}>
              <View style={styles.rowBetween}>
                <View style={styles.rowLeft}>
                  <Text style={styles.webhookTitle}>{webhook.url}</Text>
                  <Text style={styles.webhookMeta}>Merchant: {webhook.merchantId}</Text>
                </View>
                <View style={[styles.statusBadge, webhook.isPaused && styles.statusBadgePaused]}>
                  <Text style={styles.statusText}>{webhook.isPaused ? 'Paused' : 'Active'}</Text>
                </View>
              </View>

              <Text style={styles.webhookMeta}>Events: {webhook.events.join(', ')}</Text>

              <View style={styles.analyticsRow}>
                <Text style={styles.analyticsValue}>
                  {webhookAnalytics ? Math.round(webhookAnalytics.successRate * 100) : 0}%
                </Text>
                <Text style={styles.analyticsLabel}>success rate</Text>
              </View>
              <Text style={styles.webhookMeta}>
                Avg latency: {Math.round(webhookAnalytics?.avgLatencyMs ?? 0)}ms
              </Text>

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() =>
                    webhook.isPaused ? resumeWebhook(webhook.id) : pauseWebhook(webhook.id)
                  }>
                  <Text style={styles.actionButtonText}>
                    {webhook.isPaused ? 'Resume' : 'Pause'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionButton} onPress={() => startEdit(webhook)}>
                  <Text style={styles.actionButtonText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => sendTestEvent(webhook.id, webhook.events[0])}>
                  <Text style={styles.actionButtonText}>Send test</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => navigation.navigate('WebhookLogs', { webhookId: webhook.id })}>
                  <Text style={styles.actionButtonText}>Logs & DLQ</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionButtonDanger}
                  onPress={() => onDelete(webhook.id)}>
                  <Text style={styles.actionButtonText}>Delete</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.subsectionTitle}>Recent deliveries</Text>
              {latestDeliveries.length === 0 ? (
                <Text style={styles.emptyText}>No deliveries yet.</Text>
              ) : (
                latestDeliveries.map((delivery) => (
                  <View key={delivery.id} style={styles.deliveryRow}>
                    <View style={styles.deliveryInfo}>
                      <Text style={styles.deliveryEvent}>{delivery.eventType}</Text>
                      <Text style={styles.deliveryMeta}>
                        {webhookStatusLabels[delivery.status]} · attempts {delivery.attempts}/
                        {delivery.maxAttempts}
                      </Text>
                    </View>
                    {delivery.status === 'failed' ? (
                      <TouchableOpacity
                        style={styles.retryButton}
                        onPress={() => retryDelivery(delivery.id)}>
                        <Text style={styles.retryButtonText}>Retry</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ))
              )}
            </Card>
          );
        })}
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
  },
  header: {
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.h1,
    color: colors.text,
  },
  subtitle: {
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
  subsectionTitle: {
    color: colors.text,
    fontWeight: '600',
    marginTop: spacing.sm,
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
  eventGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  eventChip: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.round,
  },
  eventChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  eventChipText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  eventChipTextActive: {
    color: colors.text,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.text,
    fontWeight: '700',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.textSecondary,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowLeft: {
    flex: 1,
    gap: 4,
  },
  webhookTitle: {
    color: colors.text,
    fontWeight: '700',
  },
  webhookMeta: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.round,
    backgroundColor: colors.success,
  },
  statusBadgePaused: {
    backgroundColor: colors.warning,
  },
  statusText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  analyticsRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  analyticsValue: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
  },
  analyticsLabel: {
    color: colors.textSecondary,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actionButton: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  actionButtonDanger: {
    borderWidth: 1,
    borderColor: colors.error,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  actionButtonText: {
    color: colors.text,
    fontWeight: '600',
  },
  deliveryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  deliveryInfo: {
    flex: 1,
    gap: 2,
  },
  deliveryEvent: {
    color: colors.text,
    fontWeight: '600',
  },
  deliveryMeta: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
  },
  retryButtonText: {
    color: colors.text,
    fontWeight: '700',
  },
  emptyText: {
    color: colors.textSecondary,
  },
});

export default WebhookSettingsScreen;
