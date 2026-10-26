import React, { useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { useBillingAlignmentStore } from '../store/billingAlignmentStore';
import { AlignmentTargetDay } from '../types/billingAlignment';
import { borderRadius, colors, spacing, typography } from '../utils/constants';
import { formatCurrency } from '../utils/formatting';

const TARGET_DAY_OPTIONS: { value: AlignmentTargetDay; label: string }[] = [
  { value: AlignmentTargetDay.DAY_1, label: 'Day 1' },
  { value: AlignmentTargetDay.DAY_15, label: 'Day 15' },
];

const BillingAlignmentScreen: React.FC = () => {
  const navigation = useNavigation();
  const { subscriptions } = useSubscriptionStore();
  const { previewAlignment, confirmAlignment, canRealign, daysUntilNextRealignment } =
    useBillingAlignmentStore();
  const updateSubscription = useSubscriptionStore((s) => s.updateSubscription);

  const [targetDay, setTargetDay] = useState<AlignmentTargetDay>(AlignmentTargetDay.DAY_1);
  const [confirmed, setConfirmed] = useState(false);

  const preview = useMemo(
    () => previewAlignment(subscriptions, targetDay),
    [subscriptions, targetDay, previewAlignment]
  );

  const locked = !canRealign();
  const lockDays = daysUntilNextRealignment();

  const handleConfirm = async () => {
    const ok = confirmAlignment(preview);
    if (!ok) return;

    for (const item of preview.previews) {
      if (item.excludedReason) continue;
      await updateSubscription(item.subscriptionId, { nextBillingDate: item.alignedBillingDate });
    }
    setConfirmed(true);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Align Billing Dates</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionLabel}>Choose a billing day</Text>
        <View style={styles.dayRow}>
          {TARGET_DAY_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[styles.dayChip, targetDay === option.value && styles.dayChipActive]}
              onPress={() => setTargetDay(option.value)}>
              <Text
                style={[
                  styles.dayChipText,
                  targetDay === option.value && styles.dayChipTextActive,
                ]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {locked && (
          <Card variant="outlined" style={styles.lockCard}>
            <Text style={styles.lockText}>
              You can realign again in {lockDays} day{lockDays === 1 ? '' : 's'} (max once every 90
              days).
            </Text>
          </Card>
        )}

        <Text style={styles.sectionLabel}>Preview</Text>
        {preview.previews.map((p) => (
          <Card key={p.subscriptionId} style={styles.previewCard}>
            <View style={styles.previewRow}>
              <Text style={styles.previewName}>{p.subscriptionName}</Text>
              {p.excludedReason ? (
                <Text style={styles.excludedText}>Excluded (free)</Text>
              ) : (
                <Text
                  style={[
                    styles.previewAmount,
                    { color: p.isCredit ? colors.success : colors.warning },
                  ]}>
                  {p.isCredit ? '-' : '+'}
                  {formatCurrency(p.proratedAmount, 'USD')}
                </Text>
              )}
            </View>
            <Text style={styles.previewDates}>
              {p.currentBillingDate.toLocaleDateString()} →{' '}
              {p.alignedBillingDate.toLocaleDateString()} ({p.daysShifted >= 0 ? '+' : ''}
              {p.daysShifted}d)
            </Text>
          </Card>
        ))}

        <Card style={styles.totalsCard}>
          <View style={styles.previewRow}>
            <Text style={styles.totalsLabel}>Net {preview.isNetCredit ? 'credit' : 'charge'}</Text>
            <Text style={styles.totalsAmount}>{formatCurrency(preview.netAmount, 'USD')}</Text>
          </View>
        </Card>

        {confirmed ? (
          <Text style={styles.successText}>Billing dates aligned successfully.</Text>
        ) : (
          <Button
            title="Confirm Alignment"
            onPress={handleConfirm}
            disabled={locked || preview.previews.length === 0}
            style={styles.confirmButton}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { marginRight: spacing.md },
  title: { ...typography.h3, color: colors.text },
  scrollContent: { padding: spacing.md },
  sectionLabel: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  dayRow: { flexDirection: 'row', gap: spacing.sm },
  dayChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dayChipActive: { borderColor: colors.primary, backgroundColor: `${colors.primary}22` },
  dayChipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  dayChipTextActive: { color: colors.text },
  lockCard: { marginTop: spacing.md },
  lockText: { ...typography.caption, color: colors.warning },
  previewCard: { marginBottom: spacing.sm },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  previewName: { ...typography.body, color: colors.text, fontWeight: '600' },
  previewAmount: { ...typography.body, fontWeight: '600' },
  excludedText: { ...typography.caption, color: colors.textSecondary },
  previewDates: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  totalsCard: { marginTop: spacing.sm, marginBottom: spacing.lg },
  totalsLabel: { ...typography.body, fontWeight: '600', color: colors.text },
  totalsAmount: { ...typography.h3, color: colors.primary },
  successText: {
    ...typography.body,
    color: colors.success,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  confirmButton: { marginTop: spacing.md },
});

export default BillingAlignmentScreen;
