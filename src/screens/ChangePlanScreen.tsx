import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  FlatList,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import {
  useSubscriptionStore,
  SubscriptionChange,
  ProrationEffectiveType,
} from '../store/subscriptionStore';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { useThemeColors } from '../hooks/useThemeColors';
import { spacing, typography, borderRadius } from '../utils/constants';
import { formatCurrency } from '../utils/formatting';

type Props = NativeStackScreenProps<RootStackParamList, 'ChangePlan'>;

const EFFECTIVE_TYPES: { key: ProrationEffectiveType; label: string; desc: string }[] = [
  { key: 'immediate', label: 'Immediate', desc: 'Change takes effect now with proration' },
  { key: 'end_of_period', label: 'Next Billing', desc: 'Change takes effect at next billing date' },
  { key: 'custom_date', label: 'Custom Date', desc: 'Choose when the change takes effect' },
];

const ChangePlanScreen: React.FC<Props> = ({ route }) => {
  const { subscriptionId } = route.params;
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const {
    subscriptions,
    isLoading,
    prorationPreview,
    previewPlanChange,
    queuePlanChange,
    approvePlanChange,
    rejectPlanChange,
    getChangeHistory,
  } = useSubscriptionStore();

  const subscription = subscriptions.find((s) => s.id === subscriptionId);
  const changeHistory = useMemo(
    () => getChangeHistory(subscriptionId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subscriptionId]
  );

  const [newPrice, setNewPrice] = useState('');
  const [effectiveType, setEffectiveType] = useState<ProrationEffectiveType>('immediate');

  const handlePreview = useCallback(() => {
    const parsed = parseFloat(newPrice);
    if (isNaN(parsed) || parsed <= 0) return;
    try {
      previewPlanChange(
        subscriptionId,
        parsed,
        effectiveType === 'end_of_period' ? 'end_of_period' : 'immediate'
      );
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    }
  }, [newPrice, effectiveType, subscriptionId, previewPlanChange]);

  const handleQueueChange = useCallback(() => {
    const parsed = parseFloat(newPrice);
    if (isNaN(parsed) || parsed <= 0) {
      Alert.alert('Invalid Price', 'Enter a valid new price');
      return;
    }
    try {
      queuePlanChange(subscriptionId, { price: parsed }, effectiveType);
      setNewPrice('');
      Alert.alert('Change Queued', 'Plan change queued. Approve it below to apply.');
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    }
  }, [newPrice, effectiveType, subscriptionId, queuePlanChange]);

  const handleApprove = useCallback(
    async (changeId: string) => {
      try {
        await approvePlanChange(changeId);
        Alert.alert('Approved', 'Plan change has been applied.');
      } catch (e) {
        Alert.alert('Error', (e as Error).message);
      }
    },
    [approvePlanChange]
  );

  const handleReject = useCallback(
    (changeId: string) => {
      rejectPlanChange(changeId);
    },
    [rejectPlanChange]
  );

  const renderChangeItem = ({ item }: { item: SubscriptionChange }) => (
    <Card style={styles.changeCard}>
      <View style={styles.changeHeader}>
        <Text style={styles.changeLabel}>
          {formatCurrency(item.fromPrice, subscription?.currency ?? 'USD')} →{' '}
          {formatCurrency(item.toPrice, subscription?.currency ?? 'USD')}
        </Text>
        <Text
          style={[
            styles.changeBadge,
            item.status === 'pending' && { color: colors.status.warning },
            item.status === 'executed' && { color: colors.status.success },
            item.status === 'rejected' && { color: colors.status.error },
          ]}>
          {item.status.toUpperCase()}
        </Text>
      </View>
      <Text style={styles.changeDesc}>{item.proration.description}</Text>
      <Text style={styles.changeDate}>
        Effective: {item.effectiveType} · Created: {new Date(item.createdAt).toLocaleDateString()}
      </Text>
      {item.status === 'pending' && (
        <View style={styles.changeActions}>
          <Button title="Approve" onPress={() => handleApprove(item.id)} />
          <Button title="Reject" onPress={() => handleReject(item.id)} variant="secondary" />
        </View>
      )}
    </Card>
  );

  if (!subscription) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>Subscription not found</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>Current Plan</Text>
          <Text style={styles.currentPrice}>
            {formatCurrency(subscription.price, subscription.currency)} /{' '}
            {subscription.billingCycle}
          </Text>
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>New Price</Text>
          <TextInput
            style={styles.input}
            value={newPrice}
            onChangeText={setNewPrice}
            keyboardType="decimal-pad"
            placeholder={`Current: ${subscription.price}`}
            placeholderTextColor={colors.textSecondary}
            onBlur={handlePreview}
          />
          <Text style={styles.sectionTitle}>Effective Date</Text>
          <View style={styles.typeRow}>
            {EFFECTIVE_TYPES.map((t) => (
              <TouchableOpacity
                key={t.key}
                style={[styles.typeButton, effectiveType === t.key && styles.typeButtonActive]}
                onPress={() => setEffectiveType(t.key)}>
                <Text
                  style={[
                    styles.typeButtonText,
                    effectiveType === t.key && styles.typeButtonTextActive,
                  ]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.typeDesc}>
            {EFFECTIVE_TYPES.find((t) => t.key === effectiveType)?.desc}
          </Text>
        </Card>

        {prorationPreview && (
          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>Proration Preview</Text>
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>
                {prorationPreview.isCredit ? 'Credit' : 'Charge'}
              </Text>
              <Text
                style={[
                  styles.previewAmount,
                  {
                    color: prorationPreview.isCredit
                      ? colors.status.success
                      : colors.status.warning,
                  },
                ]}>
                {formatCurrency(prorationPreview.amount, subscription.currency)}
              </Text>
            </View>
            <Text style={styles.previewDesc}>{prorationPreview.description}</Text>
          </Card>
        )}

        <View style={styles.buttonContainer}>
          <Button
            title={isLoading ? 'Processing...' : 'Queue Plan Change'}
            onPress={handleQueueChange}
            disabled={isLoading || !newPrice}
            loading={isLoading}
          />
        </View>

        {changeHistory.length > 0 && (
          <View style={styles.historySection}>
            <Text style={styles.sectionTitle}>Change History</Text>
            <FlatList
              data={changeHistory}
              keyExtractor={(item) => item.id}
              renderItem={renderChangeItem}
              scrollEnabled={false}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background.primary },
    scrollView: { flex: 1 },
    card: { margin: spacing.lg, marginBottom: spacing.md },
    sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.sm },
    currentPrice: { ...typography.h2, color: colors.text },
    input: {
      ...typography.body,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      color: colors.text,
      backgroundColor: colors.surface,
      marginBottom: spacing.md,
    },
    typeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
    typeButton: {
      flex: 1,
      padding: spacing.sm,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    typeButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    typeButtonText: { ...typography.caption, color: colors.text },
    typeButtonTextActive: { color: colors.text, fontWeight: '600' },
    typeDesc: { ...typography.caption, color: colors.textSecondary },
    previewRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.xs,
    },
    previewLabel: { ...typography.body, color: colors.textSecondary },
    previewAmount: { ...typography.h3, fontWeight: '700' },
    previewDesc: { ...typography.caption, color: colors.textSecondary },
    buttonContainer: { padding: spacing.lg, paddingTop: 0 },
    historySection: { padding: spacing.lg, paddingTop: 0 },
    changeCard: { marginBottom: spacing.md },
    changeHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.xs,
    },
    changeLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
    changeBadge: { ...typography.caption, fontWeight: '600' },
    changeDesc: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
    changeDate: { ...typography.caption, color: colors.textSecondary },
    changeActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    errorText: { ...typography.body, color: colors.status.error, padding: spacing.lg },
  });
}

export default ChangePlanScreen;
