/**
 * SMS consent screen (#1747)
 *
 * Shows, per phone number, whether we may text the subscriber and where that
 * decision came from — the provenance the STOP keyword alone cannot give. The
 * subscriber can opt out or back in from here; the resulting consent record is
 * written to the local ledger so the rest of the app can check `isOptedOut`
 * without another round trip.
 *
 * The data source is injectable so the screen can be driven with a fake client
 * in tests.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { apiClient, type ApiResponse } from '../services/network/apiClient';
import { colors, spacing, typography, borderRadius } from '../utils/constants';
import {
  useSmsConsentStore,
  type SmsConsentEvent,
  type SmsConsentRecord,
} from '../store/smsConsentStore';

/** Minimal client surface the screen depends on; `ApiClient` satisfies it. */
export interface SmsConsentClient {
  request<T>(path: string, options?: { method?: string; body?: unknown }): Promise<ApiResponse<T>>;
}

export interface SmsConsentScreenProps {
  userId?: string;
  client?: SmsConsentClient;
  service?: SmsConsentService;
}

/** Server-side consent operations, wrapped so they can be faked in tests. */
export interface SmsConsentService {
  listForUser(userId: string): Promise<SmsConsentRecord[]>;
  historyFor(phone: string): Promise<SmsConsentEvent[]>;
  setStatus(
    phone: string,
    status: 'opted_in' | 'opted_out',
    source: 'web_form' | 'admin'
  ): Promise<SmsConsentRecord>;
}

export function createSmsConsentService(client: SmsConsentClient = apiClient): SmsConsentService {
  return {
    async listForUser(userId) {
      const res = await client.request<{ consents: SmsConsentRecord[] }>(
        `/api/sms-consent/user/${encodeURIComponent(userId)}`
      );
      return res.data?.consents ?? [];
    },
    async historyFor(phone) {
      const res = await client.request<{ events: SmsConsentEvent[] }>(
        `/api/sms-consent/${encodeURIComponent(phone)}/events`
      );
      return res.data?.events ?? [];
    },
    async setStatus(phone, status, source) {
      const res = await client.request<SmsConsentRecord>(
        `/api/sms-consent/${encodeURIComponent(phone)}/${status === 'opted_out' ? 'opt-out' : 'opt-in'}`,
        { method: 'POST', body: { source } }
      );
      return res.data;
    },
  };
}

const SOURCE_LABELS: Record<string, string> = {
  web_form: 'Web form',
  inbound_sms: 'Text message',
  admin: 'Admin',
  import: 'Imported',
  api: 'API',
  system: 'System',
};

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const SmsConsentScreen: React.FC<SmsConsentScreenProps> = ({
  userId = 'current_user',
  client,
  service,
}) => {
  const svc = service ?? createSmsConsentService(client);
  const { consents, ingest, applyConsent, historyFor } = useSmsConsentStore();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyPhone, setBusyPhone] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    svc
      .listForUser(userId)
      .then((records) => {
        if (!active) return;
        ingest(records);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load consent records');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [svc, userId, ingest]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    svc
      .listForUser(userId)
      .then((records) => {
        ingest(records);
        setError(null);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load consent records')
      )
      .finally(() => setRefreshing(false));
  }, [svc, userId, ingest]);

  const toggleStatus = useCallback(
    async (record: SmsConsentRecord) => {
      const next = record.status === 'opted_out' ? 'opted_in' : 'opted_out';
      setBusyPhone(record.phone);
      setError(null);
      try {
        const updated = await svc.setStatus(record.phone, next, 'web_form');
        const events = await svc.historyFor(record.phone);
        applyConsent(updated, events[0]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update consent');
      } finally {
        setBusyPhone(null);
      }
    },
    [svc, applyConsent]
  );

  const toggleExpanded = useCallback((phone: string) => {
    setExpanded((current) => (current === phone ? null : phone));
  }, []);

  return (
    <View style={styles.container} testID="sms-consent-screen">
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <Text style={styles.title}>SMS consent</Text>
        <Text style={styles.subtitle}>Who we may text, and where each decision came from.</Text>

        {error && (
          <View style={styles.errorBox} testID="sms-consent-error">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {loading ? (
          <ActivityIndicator testID="sms-consent-loading" color={colors.primary} />
        ) : consents.length === 0 ? (
          <Text style={styles.empty} testID="sms-consent-empty">
            No phone numbers on file.
          </Text>
        ) : (
          consents.map((record) => {
            const optedOut = record.status === 'opted_out';
            const events = expanded === record.phone ? historyFor(record.phone) : [];
            return (
              <View key={record.phone} style={styles.card} testID={`sms-consent-${record.phone}`}>
                <View style={styles.cardHeader}>
                  <Text style={styles.phone}>{record.phone}</Text>
                  <View
                    style={[
                      styles.statusBadge,
                      optedOut ? styles.badgeOptedOut : styles.badgeOptedIn,
                    ]}>
                    <Text style={styles.statusText}>{optedOut ? 'Opted out' : 'Opted in'}</Text>
                  </View>
                </View>

                <Text style={styles.meta}>
                  Source: {SOURCE_LABELS[record.source] ?? record.source}
                  {record.reason ? ` · ${record.reason}` : ''}
                </Text>
                <Text style={styles.meta}>Updated {formatTimestamp(record.updatedAt)}</Text>
                {record.explicitOptIn && (
                  <Text style={styles.meta} testID={`sms-consent-express-${record.phone}`}>
                    Express consent on file
                  </Text>
                )}

                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[
                      styles.actionButton,
                      optedOut ? styles.actionPrimary : styles.actionDanger,
                    ]}
                    onPress={() => void toggleStatus(record)}
                    disabled={busyPhone === record.phone}
                    testID={`sms-consent-toggle-${record.phone}`}>
                    {busyPhone === record.phone ? (
                      <ActivityIndicator color={colors.onPrimary} />
                    ) : (
                      <Text style={styles.actionText}>{optedOut ? 'Opt back in' : 'Opt out'}</Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.linkButton}
                    onPress={() => toggleExpanded(record.phone)}
                    testID={`sms-consent-history-toggle-${record.phone}`}>
                    <Text style={styles.linkText}>
                      {expanded === record.phone ? 'Hide history' : 'View history'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {expanded === record.phone && (
                  <View style={styles.history} testID={`sms-consent-history-${record.phone}`}>
                    {events.length === 0 ? (
                      <Text style={styles.meta}>No recorded events.</Text>
                    ) : (
                      events.map((event, index) => (
                        <Text key={`${event.at}-${index}`} style={styles.historyRow}>
                          {formatTimestamp(event.at)} ·{' '}
                          {event.status === 'opted_out' ? 'Opted out' : 'Opted in'} ·{' '}
                          {SOURCE_LABELS[event.source] ?? event.source}
                        </Text>
                      ))
                    )}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md },
  title: {
    color: colors.textPrimary,
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
  },
  subtitle: { color: colors.textSecondary, fontSize: typography.fontSize.sm },
  errorBox: {
    backgroundColor: colors.warningBackground,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
  },
  errorText: { color: colors.error, fontSize: typography.fontSize.sm },
  empty: { color: colors.textSecondary, fontSize: typography.fontSize.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  phone: {
    color: colors.textPrimary,
    fontSize: typography.fontSize.md,
    fontWeight: typography.fontWeight.bold,
  },
  statusBadge: {
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  badgeOptedIn: { backgroundColor: colors.success },
  badgeOptedOut: { backgroundColor: colors.error },
  statusText: { color: colors.onPrimary, fontSize: typography.fontSize.xs },
  meta: { color: colors.textSecondary, fontSize: typography.fontSize.xs },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  actionButton: {
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionPrimary: { backgroundColor: colors.primary },
  actionDanger: { backgroundColor: colors.error },
  actionText: { color: colors.onPrimary, fontSize: typography.fontSize.sm },
  linkButton: { paddingVertical: spacing.sm },
  linkText: { color: colors.accent, fontSize: typography.fontSize.sm },
  history: { marginTop: spacing.sm, gap: spacing.xs },
  historyRow: { color: colors.textSecondary, fontSize: typography.fontSize.xs },
});

export default SmsConsentScreen;
