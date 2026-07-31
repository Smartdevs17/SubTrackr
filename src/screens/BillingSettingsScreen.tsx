import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useCallback, useState } from 'react';
import {
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { Card } from '../components/common/Card';
import { useBillingStore } from '../store/billingStore';
import type { AdjustmentPolicy, CalendarBilling } from '../types/calendar';
import { borderRadius, colors, spacing, typography } from '../utils/constants';
import { normalizeBillingDay } from '../services/calendarService';

// ── Constants ──────────────────────────────────────────────────────────────

const ADJUSTMENT_POLICY_OPTIONS: { value: AdjustmentPolicy; label: string; description: string }[] =
  [
    {
      value: 'last_day',
      label: 'Last day of month',
      description: 'Bill on the last valid day (e.g. Jan 31 → Feb 28/29)',
    },
    {
      value: 'first_day_next',
      label: 'First of next month',
      description: 'Roll over to the 1st of the following month',
    },
    {
      value: 'skip',
      label: 'Skip short months',
      description: 'Skip billing entirely for months without the target day',
    },
  ];

const INTERVAL_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: 'Monthly' },
  { value: 2, label: 'Every 2 months' },
  { value: 3, label: 'Quarterly' },
  { value: 6, label: 'Semi-annually' },
  { value: 12, label: 'Annually' },
];

const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);

// ── Helpers ────────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function formatBillingDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ── Default config ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG: CalendarBilling = {
  day_of_month: 1,
  billing_months_interval: 1,
  adjustment_policy: 'last_day',
  timezone: 'UTC',
};

// ── Component ──────────────────────────────────────────────────────────────

/**
 * BillingSettingsScreen
 *
 * Allows a merchant to configure calendar-based billing:
 * - Choose the day of month to bill on
 * - Choose the billing interval (monthly, quarterly, etc.)
 * - Choose how to handle months with fewer days
 * - Preview the next billing date
 * - View generated invoices
 */
const BillingSettingsScreen: React.FC = () => {
  // For demo purposes we use a fixed merchantId; in production this would
  // come from an auth store or route params.
  const MERCHANT_ID = 'merchant_default';

  const {
    schedules,
    setMerchantCalendarBilling,
    removeMerchantCalendarBilling,
    advanceSchedule,
    generateInvoice,
    updateInvoiceStatus,
    getInvoicesForMerchant,
    calculateProRata,
    error,
    clearError,
  } = useBillingStore();

  const existingSchedule = schedules[MERCHANT_ID];
  const merchantInvoices = getInvoicesForMerchant(MERCHANT_ID);

  // ── Local form state ───────────────────────────────────────────────────

  const [config, setConfig] = useState<CalendarBilling>(existingSchedule?.config ?? DEFAULT_CONFIG);
  const [showDayPicker, setShowDayPicker] = useState(false);
  const [_showProRataDemo, _setShowProRataDemo] = useState(false);
  const [proRataJoinDate, setProRataJoinDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleSave = useCallback(() => {
    if (config.day_of_month < 1 || config.day_of_month > 31) {
      Alert.alert('Invalid day', 'Day of month must be between 1 and 31.');
      return;
    }
    setMerchantCalendarBilling(MERCHANT_ID, config);
    Alert.alert('Saved', 'Calendar billing schedule has been updated.');
  }, [config, setMerchantCalendarBilling]);

  const handleRemove = useCallback(() => {
    Alert.alert(
      'Remove schedule',
      'Are you sure you want to remove the calendar billing schedule?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeMerchantCalendarBilling(MERCHANT_ID);
            setConfig(DEFAULT_CONFIG);
            Alert.alert('Removed', 'Calendar billing schedule removed.');
          },
        },
      ]
    );
  }, [removeMerchantCalendarBilling]);

  const handleGenerateDemoInvoice = useCallback(() => {
    if (!existingSchedule) {
      Alert.alert('No schedule', 'Save a billing schedule first.');
      return;
    }
    const now = new Date();
    const billingDate = new Date(existingSchedule.nextBillingDate);
    // Period: from today to billing date
    const invoice = generateInvoice({
      subscriptionId: 'sub_demo',
      merchantId: MERCHANT_ID,
      periodStart: now,
      periodEnd: billingDate,
      billingDate,
      amount: 99.99,
      currency: 'USD',
    });
    Alert.alert(
      'Invoice generated',
      `Invoice ${invoice.id}\nPeriod: ${formatBillingDate(invoice.periodStart)} → ${formatBillingDate(invoice.periodEnd)}\nAmount: ${invoice.currency} ${invoice.amount.toFixed(2)}`
    );
  }, [existingSchedule, generateInvoice]);

  const handleAdvanceSchedule = useCallback(() => {
    if (!existingSchedule) {
      Alert.alert('No schedule', 'Save a billing schedule first.');
      return;
    }
    advanceSchedule(MERCHANT_ID);
    Alert.alert('Advanced', 'Schedule moved to the next billing period.');
  }, [existingSchedule, advanceSchedule]);

  const handleProRataDemo = useCallback(() => {
    if (!existingSchedule) {
      Alert.alert('No schedule', 'Save a billing schedule first.');
      return;
    }
    const periodStart = new Date();
    periodStart.setDate(1); // Start of current month
    const periodEnd = new Date(existingSchedule.nextBillingDate);
    const proRata = calculateProRata(99.99, periodStart, periodEnd, proRataJoinDate);
    Alert.alert(
      'Pro-rata calculation',
      `Full amount: $99.99\nJoin date: ${proRataJoinDate.toLocaleDateString()}\nPro-rated charge: $${proRata.toFixed(2)}`
    );
  }, [existingSchedule, proRataJoinDate, calculateProRata]);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Billing Settings</Text>
          <Text style={styles.subtitle}>
            Configure calendar-based billing to align charges with your accounting periods.
          </Text>
        </View>

        {/* Error banner */}
        {error ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.errorButton} onPress={clearError}>
              <Text style={styles.errorButtonText}>Dismiss</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        {/* Current schedule summary */}
        {existingSchedule ? (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Active schedule</Text>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Billing day</Text>
              <Text style={styles.metricValue}>
                {ordinal(existingSchedule.config.day_of_month)}
              </Text>
            </View>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Interval</Text>
              <Text style={styles.metricValue}>
                {INTERVAL_OPTIONS.find(
                  (o) => o.value === existingSchedule.config.billing_months_interval
                )?.label ?? `Every ${existingSchedule.config.billing_months_interval} months`}
              </Text>
            </View>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>Short-month policy</Text>
              <Text style={styles.metricValue}>
                {
                  ADJUSTMENT_POLICY_OPTIONS.find(
                    (o) => o.value === existingSchedule.config.adjustment_policy
                  )?.label
                }
              </Text>
            </View>
            <View style={[styles.metricRow, styles.highlightRow]}>
              <Text style={styles.metricLabel}>Next billing date</Text>
              <Text style={[styles.metricValue, styles.highlightValue]}>
                {formatBillingDate(existingSchedule.nextBillingDate)}
              </Text>
            </View>
          </Card>
        ) : null}

        {/* Day of month picker */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Day of month</Text>
          <Text style={styles.sectionDescription}>
            Choose which calendar day billing occurs on each period.
          </Text>
          <TouchableOpacity
            style={styles.selectorButton}
            onPress={() => setShowDayPicker((v) => !v)}>
            <Text style={styles.selectorButtonText}>
              {ordinal(config.day_of_month)} of the month
            </Text>
            <Text style={styles.chevron}>{showDayPicker ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {showDayPicker ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayScroll}>
              {DAY_OPTIONS.map((day) => (
                <TouchableOpacity
                  key={day}
                  style={[styles.dayChip, day === config.day_of_month && styles.dayChipActive]}
                  onPress={() => {
                    setConfig((c) => ({ ...c, day_of_month: day }));
                    setShowDayPicker(false);
                  }}>
                  <Text
                    style={[
                      styles.dayChipText,
                      day === config.day_of_month && styles.dayChipTextActive,
                    ]}>
                    {day}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}

          {config.day_of_month > 28 ? (
            <View style={styles.warningBanner}>
              <Text style={styles.warningText}>
                ⚠️ Day {config.day_of_month} doesn't exist in all months. The short-month policy
                below controls how this is handled.
              </Text>
            </View>
          ) : null}
        </Card>

        {/* Billing interval */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Billing interval</Text>
          <Text style={styles.sectionDescription}>How often billing occurs.</Text>
          <View style={styles.optionGrid}>
            {INTERVAL_OPTIONS.map((option) => {
              const selected = config.billing_months_interval === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.optionChip, selected && styles.optionChipActive]}
                  onPress={() =>
                    setConfig((c) => ({ ...c, billing_months_interval: option.value }))
                  }>
                  <Text style={[styles.optionChipText, selected && styles.optionChipTextActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>

        {/* Adjustment policy */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Short-month handling</Text>
          <Text style={styles.sectionDescription}>
            What to do when the billing day doesn't exist in a given month (e.g. Jan 31 → Feb).
          </Text>
          {ADJUSTMENT_POLICY_OPTIONS.map((option) => {
            const selected = config.adjustment_policy === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                style={[styles.policyCard, selected && styles.policyCardActive]}
                onPress={() => setConfig((c) => ({ ...c, adjustment_policy: option.value }))}>
                <View style={styles.policyRow}>
                  <View style={[styles.radioOuter, selected && styles.radioOuterActive]}>
                    {selected ? <View style={styles.radioInner} /> : null}
                  </View>
                  <View style={styles.policyText}>
                    <Text style={[styles.policyLabel, selected && styles.policyLabelActive]}>
                      {option.label}
                    </Text>
                    <Text style={styles.policyDescription}>{option.description}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </Card>

        {/* Edge case examples */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Edge case examples</Text>
          <Text style={styles.sectionDescription}>
            How your current settings handle common edge cases.
          </Text>
          {[
            { label: 'Jan 31 → Feb', month: 2, year: 2025 },
            { label: 'Feb 29 (non-leap)', month: 2, year: 2025 },
            { label: 'Feb 29 (leap year)', month: 2, year: 2024 },
            { label: 'Mar 31 → Apr', month: 4, year: 2025 },
          ].map((example) => {
            const result = normalizeBillingDay(
              config.day_of_month,
              example.month,
              example.year,
              config.adjustment_policy
            );

            const resultStr = result
              ? new Date(Date.UTC(result.year, result.month - 1, result.day)).toLocaleDateString(
                  'en-US',
                  { month: 'short', day: 'numeric', year: 'numeric' }
                )
              : 'Skipped';

            return (
              <View key={example.label} style={styles.exampleRow}>
                <Text style={styles.exampleLabel}>{example.label}</Text>
                <Text style={[styles.exampleResult, result === null && styles.exampleSkipped]}>
                  {resultStr}
                </Text>
              </View>
            );
          })}
        </Card>

        {/* Save / Remove actions */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Actions</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={handleSave}>
            <Text style={styles.primaryButtonText}>
              {existingSchedule ? 'Update schedule' : 'Save schedule'}
            </Text>
          </TouchableOpacity>

          {existingSchedule ? (
            <>
              <TouchableOpacity
                style={[styles.primaryButton, styles.secondaryButton]}
                onPress={handleAdvanceSchedule}>
                <Text style={styles.secondaryButtonText}>Advance to next period</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.primaryButton, styles.dangerButton]}
                onPress={handleRemove}>
                <Text style={styles.primaryButtonText}>Remove schedule</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </Card>

        {/* Invoice generation demo */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Invoice generation</Text>
          <Text style={styles.sectionDescription}>
            Generate a draft invoice for the current billing period.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={handleGenerateDemoInvoice}>
            <Text style={styles.primaryButtonText}>Generate demo invoice</Text>
          </TouchableOpacity>

          {merchantInvoices.length > 0 ? (
            <View style={styles.invoiceList}>
              {merchantInvoices.slice(0, 5).map((inv) => (
                <View key={inv.id} style={styles.invoiceRow}>
                  <View style={styles.invoiceInfo}>
                    <Text style={styles.invoiceId}>{inv.id}</Text>
                    <Text style={styles.invoicePeriod}>
                      {formatBillingDate(inv.periodStart)} → {formatBillingDate(inv.periodEnd)}
                    </Text>
                    {inv.isProratedPeriod && inv.proratedAmount != null ? (
                      <Text style={styles.invoiceProRata}>
                        Pro-rated: {inv.currency} {inv.proratedAmount.toFixed(2)} (of{' '}
                        {inv.amount.toFixed(2)})
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.invoiceActions}>
                    <Text style={[styles.invoiceStatus, styles[`status_${inv.status}`]]}>
                      {inv.status}
                    </Text>
                    {inv.status === 'draft' ? (
                      <TouchableOpacity
                        style={styles.issueButton}
                        onPress={() => updateInvoiceStatus(inv.id, 'issued')}>
                        <Text style={styles.issueButtonText}>Issue</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>No invoices yet.</Text>
          )}
        </Card>

        {/* Pro-rata demo */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Pro-rata calculator</Text>
          <Text style={styles.sectionDescription}>
            Preview the pro-rated charge for a mid-period subscription start.
          </Text>

          <Text style={styles.fieldLabel}>Subscription join date</Text>
          <TouchableOpacity style={styles.selectorButton} onPress={() => setShowDatePicker(true)}>
            <Text style={styles.selectorButtonText}>
              {proRataJoinDate.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </Text>
          </TouchableOpacity>

          {showDatePicker ? (
            <DateTimePicker
              value={proRataJoinDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_event, date) => {
                setShowDatePicker(Platform.OS === 'ios');
                if (date) setProRataJoinDate(date);
              }}
            />
          ) : null}

          <TouchableOpacity
            style={[styles.primaryButton, { marginTop: spacing.md }]}
            onPress={handleProRataDemo}>
            <Text style={styles.primaryButtonText}>Calculate pro-rata</Text>
          </TouchableOpacity>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────────

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
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  highlightRow: {
    borderBottomWidth: 0,
    marginTop: spacing.xs,
  },
  metricLabel: { ...typography.body, color: colors.textSecondary },
  metricValue: { ...typography.body, color: colors.text, fontWeight: '600' },
  highlightValue: { color: colors.primary, ...typography.h3 },
  selectorButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  selectorButtonText: { ...typography.body, color: colors.text },
  chevron: { ...typography.body, color: colors.textSecondary },
  dayScroll: { marginTop: spacing.md },
  dayChip: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
  dayChipActive: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}22`,
  },
  dayChipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  dayChipTextActive: { color: colors.text },
  warningBanner: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.warningBackground,
    borderWidth: 1,
    borderColor: `${colors.warning}44`,
  },
  warningText: { ...typography.caption, color: colors.warning },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  optionChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionChipActive: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}22`,
  },
  optionChipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  optionChipTextActive: { color: colors.text },
  policyCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  policyCardActive: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}14`,
  },
  policyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioOuterActive: { borderColor: colors.primary },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  policyText: { flex: 1 },
  policyLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
  policyLabelActive: { color: colors.text },
  policyDescription: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  exampleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  exampleLabel: { ...typography.caption, color: colors.textSecondary },
  exampleResult: { ...typography.caption, color: colors.text, fontWeight: '600' },
  exampleSkipped: { color: colors.warning },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  primaryButtonText: { ...typography.button, color: colors.onPrimary, fontWeight: '700' },
  secondaryButton: {
    backgroundColor: colors.surfaceVariant,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: { ...typography.button, color: colors.text, fontWeight: '600' },
  dangerButton: { backgroundColor: colors.error },
  fieldLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    fontWeight: '600',
  },
  invoiceList: { marginTop: spacing.md, gap: spacing.sm },
  invoiceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  invoiceInfo: { flex: 1, gap: spacing.xs },
  invoiceId: { ...typography.small, color: colors.textSecondary, fontFamily: 'monospace' },
  invoicePeriod: { ...typography.caption, color: colors.text },
  invoiceProRata: { ...typography.small, color: colors.accent },
  invoiceActions: { alignItems: 'flex-end', gap: spacing.xs },
  invoiceStatus: { ...typography.small, fontWeight: '700', textTransform: 'uppercase' },
  status_draft: { color: colors.textSecondary },
  status_issued: { color: colors.accent },
  status_paid: { color: colors.success },
  status_void: { color: colors.error },
  issueButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: `${colors.accent}22`,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  issueButtonText: { ...typography.small, color: colors.accent, fontWeight: '600' },
  emptyText: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm },
  errorCard: {
    borderWidth: 1,
    borderColor: `${colors.error}66`,
    backgroundColor: `${colors.error}12`,
    gap: spacing.md,
    padding: spacing.md,
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
});

export default BillingSettingsScreen;
