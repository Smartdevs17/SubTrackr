import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { Card } from '../components/common/Card';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useWebhookStore, webhookStatusLabels } from '../store/webhookStore';
import type { RootStackParamList } from '../navigation/types';

type WebhookLogsRouteProp = RouteProp<RootStackParamList, 'WebhookLogs'>;

const formatDateTime = (timestamp?: number): string =>
  timestamp ? new Date(timestamp).toLocaleString() : '—';

const WebhookLogsScreen: React.FC = () => {
  const route = useRoute<WebhookLogsRouteProp>();
  const webhookId = route.params?.webhookId;
  const {
    webhooks,
    getWebhookDeliveries,
    getDeadLetters,
    replayDeadLetter,
    rotateSecret,
    getAnalytics,
  } = useWebhookStore();

  const [tab, setTab] = useState<'logs' | 'deadLetters'>('logs');

  const webhook = webhooks.find((entry) => entry.id === webhookId);
  const deliveries = useMemo(
    () => (webhookId ? getWebhookDeliveries(webhookId, 50).slice().reverse() : []),
    [webhookId, getWebhookDeliveries]
  );
  const deadLetters = useMemo(() => getDeadLetters(webhookId), [webhookId, getDeadLetters]);
  const analytics = webhookId ? getAnalytics(webhookId) : undefined;

  const handleReplay = (deliveryId: string) => {
    replayDeadLetter(deliveryId).catch((error) =>
      Alert.alert(
        'Replay failed',
        error instanceof Error ? error.message : 'Could not replay delivery'
      )
    );
  };

  const handleRotateSecret = () => {
    if (!webhookId) return;
    Alert.alert(
      'Rotate signing secret',
      'The previous secret stays valid for 24h so in-flight receivers keep working.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rotate',
          onPress: () =>
            rotateSecret(webhookId).catch((error) =>
              Alert.alert(
                'Rotation failed',
                error instanceof Error ? error.message : 'Could not rotate secret'
              )
            ),
        },
      ]
    );
  };

  if (!webhook) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Webhook not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Delivery logs</Text>
          <Text style={styles.subtitle}>{webhook.url}</Text>
          {webhook.disabledReason ? (
            <View style={styles.disabledBanner}>
              <Text style={styles.disabledBannerText}>Auto-disabled: {webhook.disabledReason}</Text>
            </View>
          ) : null}
        </View>

        <Card style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>
                {Math.round((analytics?.successRate ?? 0) * 100)}%
              </Text>
              <Text style={styles.summaryLabel}>Success rate</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{Math.round(analytics?.avgLatencyMs ?? 0)}ms</Text>
              <Text style={styles.summaryLabel}>Avg latency</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{deadLetters.length}</Text>
              <Text style={styles.summaryLabel}>Dead letters</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.rotateButton} onPress={handleRotateSecret}>
            <Text style={styles.rotateButtonText}>Rotate signing secret</Text>
          </TouchableOpacity>
        </Card>

        <View style={styles.tabRow} accessibilityRole="tablist">
          <TouchableOpacity
            style={[styles.tabButton, tab === 'logs' && styles.tabButtonActive]}
            onPress={() => setTab('logs')}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === 'logs' }}>
            <Text style={[styles.tabButtonText, tab === 'logs' && styles.tabButtonTextActive]}>
              Logs ({deliveries.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, tab === 'deadLetters' && styles.tabButtonActive]}
            onPress={() => setTab('deadLetters')}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === 'deadLetters' }}>
            <Text
              style={[styles.tabButtonText, tab === 'deadLetters' && styles.tabButtonTextActive]}>
              Dead letter queue ({deadLetters.length})
            </Text>
          </TouchableOpacity>
        </View>

        {tab === 'logs' ? (
          deliveries.length === 0 ? (
            <Text style={styles.emptyText}>No deliveries yet.</Text>
          ) : (
            deliveries.map((delivery) => (
              <Card key={delivery.id} style={styles.logCard}>
                <View style={styles.rowBetween}>
                  <Text style={styles.logEvent}>{delivery.eventType}</Text>
                  <Text style={styles.logStatus}>{webhookStatusLabels[delivery.status]}</Text>
                </View>
                <Text style={styles.logMeta}>
                  {delivery.responseCode ?? '—'} · {delivery.latencyMs ?? '—'}ms · attempt{' '}
                  {delivery.attempts}/{delivery.maxAttempts}
                </Text>
                <Text style={styles.logMeta}>
                  {formatDateTime(delivery.lastAttemptAt ?? delivery.createdAt)}
                </Text>
                {delivery.payloadTruncated ? (
                  <Text style={styles.truncatedNotice}>
                    Payload truncated (&gt;1MB) — hash {delivery.payloadHash?.slice(0, 12)}…
                  </Text>
                ) : null}
                {delivery.errorMessage ? (
                  <Text style={styles.errorText}>{delivery.errorMessage}</Text>
                ) : null}
                {delivery.bodyPreview ? (
                  <Text style={styles.bodyPreview} numberOfLines={3}>
                    {delivery.bodyPreview}
                  </Text>
                ) : null}
              </Card>
            ))
          )
        ) : deadLetters.length === 0 ? (
          <Text style={styles.emptyText}>No dead-lettered deliveries. 🎉</Text>
        ) : (
          deadLetters.map((delivery) => (
            <Card key={delivery.id} style={styles.logCard}>
              <View style={styles.rowBetween}>
                <Text style={styles.logEvent}>{delivery.eventType}</Text>
                <TouchableOpacity
                  style={styles.replayButton}
                  onPress={() => handleReplay(delivery.id)}>
                  <Text style={styles.replayButtonText}>Replay</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.logMeta}>
                Exhausted after {delivery.attempts}/{delivery.maxAttempts} attempts
              </Text>
              <Text style={styles.logMeta}>
                Dead-lettered {formatDateTime(delivery.deadLetteredAt)}
              </Text>
              {delivery.errorMessage ? (
                <Text style={styles.errorText}>{delivery.errorMessage}</Text>
              ) : null}
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  header: { marginBottom: spacing.sm },
  title: { ...typography.h1, color: colors.text },
  subtitle: { color: colors.textSecondary, marginTop: spacing.xs },
  disabledBanner: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: '#3a1d1d',
  },
  disabledBannerText: { color: '#ff8080', fontSize: 12 },
  summaryCard: { gap: spacing.md },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryItem: { alignItems: 'center', flex: 1 },
  summaryValue: { ...typography.h3, color: colors.text },
  summaryLabel: { color: colors.textSecondary, fontSize: 12, marginTop: spacing.xs },
  rotateButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  rotateButtonText: { color: colors.text, fontWeight: '600' },
  tabRow: { flexDirection: 'row', gap: spacing.sm },
  tabButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  tabButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabButtonText: { color: colors.textSecondary, fontSize: 12 },
  tabButtonTextActive: { color: colors.text, fontWeight: '600' },
  logCard: { gap: spacing.xs },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logEvent: { color: colors.text, fontWeight: '600' },
  logStatus: { color: colors.textSecondary, fontSize: 12 },
  logMeta: { color: colors.textSecondary, fontSize: 12 },
  truncatedNotice: { color: '#e0a030', fontSize: 12 },
  errorText: { color: '#ff6b6b', fontSize: 12 },
  bodyPreview: {
    color: colors.textSecondary,
    fontSize: 11,
    fontFamily: 'monospace',
    backgroundColor: colors.surface,
    padding: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  replayButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.round,
  },
  replayButtonText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  emptyText: { color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.lg },
});

export default WebhookLogsScreen;
