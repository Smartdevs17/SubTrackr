import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useThemeColors } from '../hooks/useThemeColors';
import { useConsentManager } from '../hooks/useConsentManager';
import {
  CONSENT_CATEGORIES,
  ESSENTIAL_PROCESSING,
  ConsentService,
  consentService as defaultConsentService,
} from '../services/consentService';
import { ConsentCategoryRow } from '../components/privacy/ConsentCategoryRow';

const HISTORY_PREVIEW_LIMIT = 10;

const CATEGORY_TITLES = Object.fromEntries(CONSENT_CATEGORIES.map((c) => [c.key, c.title]));

function formatTimestamp(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

interface ConsentManagementScreenProps {
  service?: ConsentService;
}

const ConsentManagementScreen = ({
  service = defaultConsentService,
}: ConsentManagementScreenProps) => {
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const consent = useConsentManager(service);

  if (consent.status === 'loading') {
    return (
      <View style={styles.centered} testID="consent-loading">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (consent.status === 'error') {
    return (
      <View style={styles.centered} testID="consent-load-error">
        <Text style={styles.errorText} accessibilityRole="alert">
          {consent.error}
        </Text>
        <TouchableOpacity
          style={styles.button}
          testID="consent-reload"
          onPress={() => void consent.reload()}
          accessibilityRole="button">
          <Text style={styles.buttonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const busy = consent.saving;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="consent-management-screen">
      <Text style={styles.title}>Consent Preferences</Text>
      <Text style={styles.subtitle}>
        Choose which optional data processing you allow. Withdrawing consent is as easy as giving it
        and takes effect immediately.
      </Text>

      {consent.error && (
        <View style={styles.banner} testID="consent-save-error">
          <Text style={styles.errorText} accessibilityRole="alert">
            {consent.error}
          </Text>
        </View>
      )}

      {consent.pendingSync && (
        <View style={styles.banner} testID="consent-pending-sync">
          <Text style={styles.bannerText}>
            Your choices are saved on this device and apply now, but haven&apos;t reached our
            servers yet.
          </Text>
          <TouchableOpacity
            testID="consent-retry-sync"
            onPress={() => void consent.retrySync()}
            disabled={busy}
            accessibilityRole="button">
            <Text style={styles.link}>Retry sync</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.card}>
        <ConsentCategoryRow
          testID="consent-essential"
          title={ESSENTIAL_PROCESSING.title}
          description={ESSENTIAL_PROCESSING.description}
          legalBasis={ESSENTIAL_PROCESSING.legalBasis}
          value
          locked
        />
        {CONSENT_CATEGORIES.map((category) => (
          <ConsentCategoryRow
            key={category.key}
            testID={`consent-${category.key}`}
            title={category.title}
            description={category.description}
            legalBasis={category.legalBasis}
            value={consent.draft[category.key]}
            onValueChange={(value) => consent.setCategory(category.key, value)}
            disabled={busy}
          />
        ))}

        <TouchableOpacity
          style={[styles.button, (!consent.isDirty || busy) && styles.buttonDisabled]}
          testID="consent-save"
          onPress={() => void consent.saveDraft('settings')}
          disabled={!consent.isDirty || busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: !consent.isDirty || busy, busy }}>
          {busy ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.buttonText}>Save preferences</Text>
          )}
        </TouchableOpacity>

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.outlineButton, styles.rowButton]}
            testID="consent-accept-all"
            onPress={() => void consent.acceptAll('settings')}
            disabled={busy}
            accessibilityRole="button">
            <Text style={styles.outlineButtonText}>Accept all</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.outlineButton, styles.rowButton]}
            testID="consent-withdraw-all"
            onPress={() => void consent.rejectAll('settings')}
            disabled={busy}
            accessibilityRole="button"
            accessibilityHint="Withdraws consent for all optional processing">
            <Text style={styles.outlineButtonText}>Withdraw all</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.meta} testID="consent-meta">
          Policy version {consent.policyVersion}
          {consent.updatedAt ? ` · Last updated ${formatTimestamp(consent.updatedAt)}` : ''}
        </Text>
      </View>

      <View style={styles.card} testID="consent-history">
        <Text style={styles.cardTitle}>Consent history</Text>
        {consent.history.length === 0 ? (
          <Text style={styles.meta}>No consent decisions recorded yet.</Text>
        ) : (
          consent.history.slice(0, HISTORY_PREVIEW_LIMIT).map((record) => (
            <View key={record.id} style={styles.historyRow} testID={`consent-history-${record.id}`}>
              <Text style={styles.historyLabel}>
                {CATEGORY_TITLES[record.category] ?? record.category}:{' '}
                {record.granted ? 'Granted' : 'Withdrawn'}
              </Text>
              <Text style={styles.meta}>
                {formatTimestamp(record.timestamp)} · v{record.version}
                {record.source ? ` · via ${record.source}` : ''}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background.primary },
    content: { padding: 16, paddingBottom: 40 },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      backgroundColor: colors.background.primary,
    },
    title: { fontSize: 24, fontWeight: '700', color: colors.text.primary, marginBottom: 8 },
    subtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: 20, lineHeight: 20 },
    card: {
      backgroundColor: colors.background.card,
      borderRadius: 12,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text.primary, marginBottom: 8 },
    banner: {
      backgroundColor: colors.warningBackground,
      borderRadius: 8,
      padding: 12,
      marginBottom: 16,
    },
    bannerText: { fontSize: 13, color: colors.text.primary, lineHeight: 18 },
    errorText: { fontSize: 13, color: colors.error, textAlign: 'center' },
    link: { fontSize: 13, fontWeight: '600', color: colors.text.link, marginTop: 8 },
    button: {
      backgroundColor: colors.primary,
      padding: 14,
      borderRadius: 8,
      alignItems: 'center',
      marginTop: 16,
    },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '600' },
    row: { flexDirection: 'row', gap: 10, marginTop: 10 },
    rowButton: { flex: 1 },
    outlineButton: {
      padding: 12,
      borderRadius: 8,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    outlineButtonText: { color: colors.text.primary, fontSize: 14, fontWeight: '600' },
    meta: { fontSize: 11, color: colors.textSecondary, marginTop: 8 },
    historyRow: {
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    historyLabel: { fontSize: 14, color: colors.text.primary, fontWeight: '500' },
  });
}

export default ConsentManagementScreen;
