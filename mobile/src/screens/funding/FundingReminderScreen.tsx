/**
 * mobile/src/screens/funding/FundingReminderScreen.tsx
 *
 * Issue #2029 — shows the low-balance prediction produced by
 * `ml-service/funding` (`reminder_to_dict`). The screen is presentational: it
 * renders one reminder and hands the suggested top-up to `onTopUp`.
 * Healthy wallets get a quiet confirmation instead of a warning.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type FundingLevel = 'ok' | 'warning' | 'urgent';

/** Shape returned by `funding.reminder_to_dict`. Amounts are integer minor units. */
export interface FundingReminderData {
  level: FundingLevel;
  balanceMinor: number;
  currency: string;
  shortfallSubscriptionId: string | null;
  shortfallDueAt: string | null;
  shortfallMinor: number;
  recommendedTopUpMinor: number;
  remindAt: string | null;
  runwayDays: number | null;
  horizonCharges: number;
  coveredSubscriptionIds: string[];
}

export interface FundingReminderScreenProps {
  reminder: FundingReminderData;
  /** Decimal places of the currency's minor unit. Defaults to 2. */
  minorUnitDigits?: number;
  locale?: string;
  onTopUp?: (amountMinor: number, currency: string) => void;
  onDismiss?: () => void;
  testID?: string;
}

export function formatMinor(
  amountMinor: number,
  currency: string,
  digits = 2,
  locale = 'en',
): string {
  const value = amountMinor / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    // Not an ISO 4217 code (for example a Stellar asset): fall back to a plain number.
    return `${value.toFixed(digits)} ${currency}`;
  }
}

function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    date,
  );
}

export const FundingReminderScreen: React.FC<FundingReminderScreenProps> = ({
  reminder,
  minorUnitDigits = 2,
  locale = 'en',
  onTopUp,
  onDismiss,
  testID = 'funding-reminder',
}) => {
  const money = (minor: number) => formatMinor(minor, reminder.currency, minorUnitDigits, locale);
  const balance = money(reminder.balanceMinor);

  if (reminder.level === 'ok') {
    return (
      <View style={[styles.card, styles.ok]} testID={testID} accessibilityRole="summary">
        <Text style={styles.title}>Wallet is funded</Text>
        <Text style={styles.body} testID={`${testID}-body`}>
          {`Balance ${balance} covers your next ${reminder.horizonCharges} charge${
            reminder.horizonCharges === 1 ? '' : 's'
          }.`}
        </Text>
      </View>
    );
  }

  const urgent = reminder.level === 'urgent';
  const due = reminder.shortfallDueAt ? formatDate(reminder.shortfallDueAt, locale) : '';
  const topUp = money(reminder.recommendedTopUpMinor);

  return (
    <View
      style={[styles.card, urgent ? styles.urgent : styles.warning]}
      testID={testID}
      accessibilityRole="alert"
      accessibilityLabel={`${urgent ? 'Urgent' : 'Low balance'}: top up ${topUp}`}>
      <Text style={styles.title}>{urgent ? 'Top up now' : 'Balance running low'}</Text>
      <Text style={styles.body} testID={`${testID}-body`}>
        {`Your balance of ${balance} will not cover the charge${
          due ? ` due ${due}` : ''
        }. You are short by ${money(reminder.shortfallMinor)}.`}
      </Text>
      {reminder.runwayDays !== null && (
        <Text style={styles.meta} testID={`${testID}-runway`}>
          {`About ${reminder.runwayDays} day${reminder.runwayDays === 1 ? '' : 's'} of cover left`}
        </Text>
      )}
      <View style={styles.actions}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Top up ${topUp}`}
          onPress={() => onTopUp?.(reminder.recommendedTopUpMinor, reminder.currency)}
          style={styles.primary}
          testID={`${testID}-topup`}>
          <Text style={styles.primaryText}>{`Top up ${topUp}`}</Text>
        </TouchableOpacity>
        {onDismiss && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Remind me later"
            onPress={onDismiss}
            testID={`${testID}-dismiss`}>
            <Text style={styles.secondaryText}>Remind me later</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 16, margin: 16, borderWidth: 1 },
  ok: { backgroundColor: '#ecfdf5', borderColor: '#10b981' },
  warning: { backgroundColor: '#fffbeb', borderColor: '#f59e0b' },
  urgent: { backgroundColor: '#fef2f2', borderColor: '#ef4444' },
  title: { fontSize: 18, fontWeight: '700', color: '#111827' },
  body: { marginTop: 8, fontSize: 15, color: '#1f2937' },
  meta: { marginTop: 4, fontSize: 13, color: '#4b5563' },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 16 },
  primary: { backgroundColor: '#111827', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  primaryText: { color: '#ffffff', fontWeight: '600' },
  secondaryText: { color: '#374151', fontWeight: '500' },
});
