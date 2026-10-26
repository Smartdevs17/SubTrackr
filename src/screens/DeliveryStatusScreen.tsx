/**
 * Delivery status screen (#1749)
 *
 * Shows, for each channel, the newest delivery receipt on record and a recent
 * timeline of attempts. Support uses it to answer "did the customer actually
 * get the SMS?" without opening a provider dashboard; subscribers can see the
 * same thing from Settings.
 *
 * The heavy lifting lives in `deliveryReceiptsStore` — this screen only decides
 * presentation: a per-channel summary card, then a list of recent attempts
 * with their status history.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';

import { useThemeColors } from '../hooks/useThemeColors';
import { useUserStore } from '../store/userStore';
import {
  useDeliveryReceiptsStore,
  STATUS_PRESENTATION,
  selectChannelSummaries,
  type DeliveryReceipt,
  type DeliveryReceiptStatus,
} from '../store/deliveryReceiptsStore';
import type { NotificationChannel } from '../types/notification';

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  email: 'Email',
  push: 'Push',
  sms: 'SMS',
  in_app: 'In-app',
};

interface Props {
  /** Defaults to the signed-in user; overridable for support tooling. */
  userId?: string;
}

const toneColor = (
  tone: 'positive' | 'pending' | 'negative' | 'neutral',
  colors: ReturnType<typeof useThemeColors>
): string => {
  switch (tone) {
    case 'positive':
      return colors.status.success;
    case 'pending':
      return colors.status.warning;
    case 'negative':
      return colors.status.error;
    default:
      return colors.text.secondary;
  }
};

const formatTimestamp = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const DeliveryStatusScreen = ({ userId: userIdProp }: Props) => {
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);

  const user = useUserStore((s) => s.user);
  const userId = userIdProp ?? user?.id ?? user?.email ?? 'local-user';

  const refresh = useDeliveryReceiptsStore((s) => s.refresh);
  const receipts = useDeliveryReceiptsStore((s) => s.receipts);
  const loading = useDeliveryReceiptsStore((s) => s.loading);
  const error = useDeliveryReceiptsStore((s) => s.error);
  const summaries = useDeliveryReceiptsStore(selectChannelSummaries);

  React.useEffect(() => {
    refresh(userId);
  }, [refresh, userId]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      accessibilityLabel="Delivery status screen">
      <View style={styles.headerRow}>
        <Text style={styles.title}>Delivery status</Text>
        <TouchableOpacity
          onPress={() => refresh(userId)}
          accessibilityRole="button"
          accessibilityLabel="Refresh delivery status"
          testID="delivery-refresh">
          <Text style={styles.refreshText}>Refresh</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.subtitle}>
        What happened after we handed each notification to its provider — including delivery
        confirmations reported back by SMS and email carriers.
      </Text>

      {loading && receipts.length === 0 && (
        <ActivityIndicator testID="delivery-loading" style={styles.loading} color={colors.accent} />
      )}

      {error && (
        <View style={styles.errorBox} testID="delivery-error">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Per-channel summary */}
      <View style={styles.card} testID="delivery-summary">
        {summaries.map((summary) => (
          <View key={summary.channel} style={styles.summaryRow}>
            <Text style={styles.summaryChannel}>{CHANNEL_LABELS[summary.channel]}</Text>
            {summary.status ? (
              <View
                style={styles.summaryStatus}
                testID={`delivery-channel-status-${summary.channel}`}>
                <Text
                  style={[
                    styles.summaryStatusText,
                    { color: toneColor(STATUS_PRESENTATION[summary.status].tone, colors) },
                  ]}>
                  {STATUS_PRESENTATION[summary.status].label}
                </Text>
                {summary.updatedAt && (
                  <Text style={styles.summaryUpdated}>{formatTimestamp(summary.updatedAt)}</Text>
                )}
              </View>
            ) : (
              <Text style={styles.summaryNone}>No activity</Text>
            )}
          </View>
        ))}
      </View>

      {/* Recent attempts */}
      {receipts.length === 0 && !loading ? (
        <View style={styles.empty} testID="delivery-empty">
          <Text style={styles.emptyTitle}>No delivery records</Text>
          <Text style={styles.emptyDesc}>
            Once we send you a notification, its delivery status will appear here.
          </Text>
        </View>
      ) : (
        receipts.map((receipt) => (
          <ReceiptRow key={receipt.id} receipt={receipt} colors={colors} styles={styles} />
        ))
      )}
    </ScrollView>
  );
};

const ReceiptRow = ({
  receipt,
  colors,
  styles,
}: {
  receipt: DeliveryReceipt;
  colors: ReturnType<typeof useThemeColors>;
  styles: ReturnType<typeof createStyles>;
}) => {
  const presentation = STATUS_PRESENTATION[receipt.status];
  return (
    <View style={styles.card} testID={`delivery-receipt-${receipt.id}`}>
      <View style={styles.receiptHeader}>
        <Text style={styles.receiptChannel}>{CHANNEL_LABELS[receipt.channel]}</Text>
        <Text
          style={[styles.receiptStatus, { color: toneColor(presentation.tone, colors) }]}
          testID={`delivery-status-${receipt.id}`}
          accessibilityLabel={`Delivery status ${presentation.label}`}>
          {presentation.label}
        </Text>
      </View>
      <Text style={styles.receiptDesc}>{presentation.description}</Text>

      <View style={styles.timeline}>
        {receipt.events.map((event, index) => (
          <View key={`${event.status}-${index}`} style={styles.timelineRow}>
            <View
              style={[
                styles.timelineDot,
                { backgroundColor: toneColor(STATUS_PRESENTATION[event.status].tone, colors) },
              ]}
            />
            <Text style={styles.timelineText}>
              {STATUS_PRESENTATION[event.status].label}
              {' · '}
              {formatTimestamp(event.at)}
              {event.detail ? ` · ${event.detail}` : ''}
            </Text>
          </View>
        ))}
      </View>

      {receipt.errorCode && (
        <Text style={styles.receiptError}>Provider error {receipt.errorCode}</Text>
      )}
    </View>
  );
};

/** Map a status to its presentation, exposed for tests and callers. */
export const presentStatus = (status: DeliveryReceiptStatus) => STATUS_PRESENTATION[status];

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background.primary },
    content: { padding: 16, paddingBottom: 40 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontSize: 24, fontWeight: '700', color: colors.text.primary },
    refreshText: { fontSize: 14, fontWeight: '600', color: colors.accent },
    subtitle: { fontSize: 13, color: colors.text.secondary, marginTop: 6, marginBottom: 12 },
    loading: { marginVertical: 16 },
    errorBox: {
      backgroundColor: colors.status.error + '22',
      padding: 12,
      borderRadius: 8,
      marginBottom: 12,
    },
    errorText: { color: colors.status.error, fontSize: 13 },
    card: {
      backgroundColor: colors.background.secondary,
      borderRadius: 12,
      padding: 14,
      marginBottom: 12,
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 6,
    },
    summaryChannel: { fontSize: 15, fontWeight: '600', color: colors.text.primary },
    summaryStatus: { alignItems: 'flex-end' },
    summaryStatusText: { fontSize: 14, fontWeight: '700' },
    summaryUpdated: { fontSize: 11, color: colors.text.secondary },
    summaryNone: { fontSize: 13, color: colors.text.secondary },
    empty: { alignItems: 'center', paddingVertical: 32 },
    emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.text.primary },
    emptyDesc: { fontSize: 13, color: colors.text.secondary, marginTop: 4, textAlign: 'center' },
    receiptHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    receiptChannel: { fontSize: 15, fontWeight: '700', color: colors.text.primary },
    receiptStatus: { fontSize: 14, fontWeight: '700' },
    receiptDesc: { fontSize: 12, color: colors.text.secondary, marginTop: 4 },
    timeline: { marginTop: 10 },
    timelineRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
    timelineDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
    timelineText: { fontSize: 12, color: colors.text.secondary, flex: 1 },
    receiptError: { fontSize: 12, color: colors.status.error, marginTop: 6 },
  });
}

export default DeliveryStatusScreen;
