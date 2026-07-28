import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
  FlatList,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useSubscriptionStore, PauseRecord } from '../store/subscriptionStore';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { useThemeColors } from '../hooks/useThemeColors';
import { spacing, typography, borderRadius } from '../utils/constants';
import { formatCurrency } from '../utils/formatting';

type Props = NativeStackScreenProps<RootStackParamList, 'SubscriptionDetail'>;

const PAUSE_DURATIONS = [
  { days: 7, label: '1 Week' },
  { days: 14, label: '2 Weeks' },
  { days: 30, label: '1 Month' },
  { days: 60, label: '2 Months' },
  { days: 90, label: '3 Months' },
];

const PauseResumeScreen: React.FC<Props> = ({ route }) => {
  const { id: subscriptionId } = route.params;
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const {
    subscriptions,
    isLoading,
    pauseRecords,
    pauseAnalytics,
    pauseSubscription,
    resumeSubscription,
    getPauseHistory,
  } = useSubscriptionStore();

  const subscription = subscriptions.find((s) => s.id === subscriptionId);
  const pauseHistory = useMemo(
    () => getPauseHistory(subscriptionId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subscriptionId]
  );

  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  const [reason, setReason] = useState('');

  const activePause = pauseHistory.find((p) => p.status === 'active');

  const handlePause = useCallback(() => {
    if (!selectedDuration) {
      Alert.alert('Select Duration', 'Please select a pause duration');
      return;
    }
    Alert.alert(
      'Pause Subscription',
      `This will pause ${subscription?.name} for ${selectedDuration} days and apply a billing adjustment. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Pause',
          style: 'destructive',
          onPress: () => {
            try {
              pauseSubscription(subscriptionId, selectedDuration, reason || undefined);
              Alert.alert('Paused', 'Subscription has been paused');
            } catch (e) {
              Alert.alert('Error', (e as Error).message);
            }
          },
        },
      ]
    );
  }, [selectedDuration, reason, subscriptionId, subscription, pauseSubscription]);

  const handleResume = useCallback(() => {
    Alert.alert(
      'Resume Subscription',
      `This will resume ${subscription?.name} and restart billing. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Resume',
          onPress: () => {
            try {
              resumeSubscription(subscriptionId);
              Alert.alert('Resumed', 'Subscription has been resumed');
            } catch (e) {
              Alert.alert('Error', (e as Error).message);
            }
          },
        },
      ]
    );
  }, [subscriptionId, subscription, resumeSubscription]);

  const renderHistoryItem = ({ item }: { item: PauseRecord }) => (
    <Card style={styles.historyCard}>
      <View style={styles.historyHeader}>
        <Text style={styles.historyDate}>
          {new Date(item.pausedAt).toLocaleDateString()}
          {item.resumeAt && ` - ${new Date(item.resumeAt).toLocaleDateString()}`}
        </Text>
        <Text
          style={[
            styles.historyBadge,
            item.status === 'active' && { color: colors.status.warning },
            item.status === 'resumed' && { color: colors.status.success },
          ]}>
          {item.status.toUpperCase()}
        </Text>
      </View>
      <Text style={styles.historyReason}>{item.reason || 'No reason provided'}</Text>
      <Text style={styles.historyAdjustment}>
        Billing adjustment:{' '}
        {formatCurrency(item.billingAdjustment, subscription?.currency ?? 'USD')}
      </Text>
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
          <Text style={styles.sectionTitle}>Subscription</Text>
          <Text style={styles.subName}>{subscription.name}</Text>
          <Text style={styles.subPrice}>
            {formatCurrency(subscription.price, subscription.currency)} /{' '}
            {subscription.billingCycle}
          </Text>
        </Card>

        {activePause ? (
          <Card style={[styles.card, styles.activePauseCard]}>
            <Text style={styles.activePauseTitle}>Currently Paused</Text>
            <Text style={styles.activePauseInfo}>
              Paused on {new Date(activePause.pausedAt).toLocaleDateString()}
            </Text>
            {activePause.plannedResumeDate && (
              <Text style={styles.activePauseInfo}>
                Planned resume: {new Date(activePause.plannedResumeDate).toLocaleDateString()}
              </Text>
            )}
            <Text style={styles.adjustmentText}>
              Billing adjustment:{' '}
              {formatCurrency(activePause.billingAdjustment, subscription.currency)}
            </Text>
            <View style={styles.buttonContainer}>
              <Button
                title={isLoading ? 'Resuming...' : 'Resume Now'}
                onPress={handleResume}
                disabled={isLoading}
                loading={isLoading}
              />
            </View>
          </Card>
        ) : (
          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>Pause Duration</Text>
            <View style={styles.durationRow}>
              {PAUSE_DURATIONS.map((d) => (
                <TouchableOpacity
                  key={d.days}
                  style={[
                    styles.durationButton,
                    selectedDuration === d.days && styles.durationButtonActive,
                  ]}
                  onPress={() => setSelectedDuration(d.days)}>
                  <Text
                    style={[
                      styles.durationButtonText,
                      selectedDuration === d.days && styles.durationButtonTextActive,
                    ]}>
                    {d.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {selectedDuration && (
              <View style={styles.adjustmentPreview}>
                <Text style={styles.adjustmentLabel}>Estimated billing adjustment:</Text>
                <Text style={styles.adjustmentAmount}>
                  {formatCurrency(
                    (subscription.price / 30) * selectedDuration,
                    subscription.currency
                  )}
                </Text>
              </View>
            )}

            <View style={styles.buttonContainer}>
              <Button
                title={isLoading ? 'Pausing...' : 'Pause Subscription'}
                onPress={handlePause}
                disabled={isLoading || !selectedDuration}
                loading={isLoading}
                variant="danger"
              />
            </View>
          </Card>
        )}

        {pauseHistory.length > 0 && (
          <View style={styles.historySection}>
            <Text style={styles.sectionTitle}>Pause History</Text>
            <FlatList
              data={pauseHistory}
              keyExtractor={(item) => item.id}
              renderItem={renderHistoryItem}
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
    sectionTitle: { ...typography.h3, color: colors.text.primary, marginBottom: spacing.sm },
    subName: { ...typography.h2, color: colors.text.primary, marginBottom: spacing.xs },
    subPrice: { ...typography.body, color: colors.textSecondary },
    durationRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    durationButton: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: colors.border.default,
      backgroundColor: colors.surface,
    },
    durationButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    durationButtonText: { ...typography.caption, color: colors.text.primary },
    durationButtonTextActive: { color: colors.text.inverse, fontWeight: '600' },
    adjustmentPreview: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.md,
      marginBottom: spacing.md,
    },
    adjustmentLabel: { ...typography.caption, color: colors.textSecondary },
    adjustmentAmount: { ...typography.h3, color: colors.status.warning, fontWeight: '700' },
    buttonContainer: { paddingTop: 0 },
    activePauseCard: { borderColor: colors.status.warning, borderWidth: 1 },
    activePauseTitle: { ...typography.h3, color: colors.status.warning, marginBottom: spacing.sm },
    activePauseInfo: { ...typography.body, color: colors.text.primary, marginBottom: spacing.xs },
    adjustmentText: {
      ...typography.body,
      color: colors.status.warning,
      fontWeight: '600',
      marginBottom: spacing.md,
    },
    historySection: { padding: spacing.lg, paddingTop: 0 },
    historyCard: { marginBottom: spacing.md },
    historyHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.xs,
    },
    historyDate: { ...typography.body, color: colors.text.primary, fontWeight: '600' },
    historyBadge: { ...typography.caption, fontWeight: '600' },
    historyReason: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs },
    historyAdjustment: { ...typography.caption, color: colors.textSecondary },
    errorText: { ...typography.body, color: colors.status.error, padding: spacing.lg },
  });
}

export default PauseResumeScreen;
