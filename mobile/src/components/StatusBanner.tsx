/**
 * mobile/src/components/StatusBanner.tsx
 *
 * Issue #2035 — user-visible surface for provider outage detection.
 *
 * The component is intentionally dumb: it renders the snapshot produced by
 * `backend/src/services/providerStatus.ts` and delegates retry/dismiss to the
 * parent. Operational snapshots render nothing so healthy users never see a
 * banner; degraded and outage snapshots render an accessible alert whose row
 * mirrors automatically in Arabic, Hebrew and Persian.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ProviderStatusSnapshot } from '../../../backend/src/services/providerStatus';
import { createAppLocalePipeline } from '../i18n/resources';

export interface StatusBannerProps {
  snapshot: ProviderStatusSnapshot;
  /** Base locale code; region tags such as `ar-SA` are normalised. */
  locale?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  testID?: string;
}

export const StatusBanner: React.FC<StatusBannerProps> = ({
  snapshot,
  locale = 'en',
  onRetry,
  onDismiss,
  testID = 'status-banner',
}) => {
  const l10n = createAppLocalePipeline(locale);

  if (snapshot.overall === 'operational') return null;

  const affected = snapshot.providers
    .filter((provider) => provider.status === 'outage' || provider.status === 'degraded')
    .map((provider) => provider.providerId);
  const affectedLabel = affected.length > 0 ? affected.join(', ') : snapshot.overall;
  const messageKey =
    snapshot.overall === 'unknown' ? 'status.degraded' : `status.${snapshot.overall}`;
  const message = l10n.translate(messageKey);
  const updated = l10n.formatDate(snapshot.updatedAt, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  const accessibilityLabel = [l10n.t('status.banner_title'), message].filter(Boolean).join(': ');

  return (
    <View
      style={[styles.container, styles[snapshot.overall]]}
      accessibilityRole="alert"
      accessibilityLabel={accessibilityLabel}
      testID={testID}>
      <View
        style={[
          styles.row,
          l10n.layoutDirection === 'rtl' ? styles.rowReverse : styles.rowForward,
        ]}>
        <View style={styles.copy}>
          <Text style={styles.title}>{l10n.t('status.banner_title')}</Text>
          <Text style={styles.message} testID={`${testID}-message`}>
            {message}
          </Text>
          <Text style={styles.detail} testID={`${testID}-affected`}>
            {l10n.t('status.affected', { provider: affectedLabel })}
          </Text>
          {updated ? (
            <Text style={styles.detail} testID={`${testID}-updated`}>
              {l10n.t('status.updated', { date: updated })}
            </Text>
          ) : null}
        </View>
        <View style={styles.actions}>
          {onRetry ? (
            <TouchableOpacity
              style={styles.button}
              onPress={onRetry}
              accessibilityRole="button"
              accessibilityLabel={l10n.t('status.retry')}
              testID={`${testID}-retry`}>
              <Text style={styles.buttonText}>{l10n.t('status.retry')}</Text>
            </TouchableOpacity>
          ) : null}
          {onDismiss ? (
            <TouchableOpacity
              style={[styles.button, styles.dismiss]}
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel={l10n.t('status.dismiss')}
              testID={`${testID}-dismiss`}>
              <Text style={styles.buttonText}>{l10n.t('status.dismiss')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  operational: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  degraded: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  outage: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  unknown: {
    backgroundColor: '#f9fafb',
    borderColor: '#e5e7eb',
  },
  row: {
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowForward: {
    flexDirection: 'row',
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  copy: {
    flex: 1,
    paddingRight: 12,
  },
  actions: {
    flexShrink: 0,
    gap: 8,
  },
  title: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
  },
  message: {
    color: '#1f2937',
    fontSize: 13,
    marginTop: 4,
  },
  detail: {
    color: '#4b5563',
    fontSize: 12,
    marginTop: 2,
  },
  button: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dismiss: {
    borderColor: 'transparent',
  },
  buttonText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '600',
  },
});
