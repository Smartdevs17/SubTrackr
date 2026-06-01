import React, { useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { colors, spacing, typography, borderRadius, shadows } from '../../utils/constants';
import { SubscriptionCard } from '../subscription/SubscriptionCard';
import { Subscription } from '../../types/subscription';
import { usePerformanceProfiler } from '../../hooks/usePerformanceProfiler';
import { EmptyState } from '../common/EmptyState';

interface SubscriptionListProps {
  subscriptions: Subscription[];
  activeSubscriptions: Subscription[];
  upcomingSubscriptions: Subscription[];
  hasSubscriptions: boolean;
  hasActiveFilters: boolean;
  filteredCount: number;
  totalCount: number;
  onSubscriptionPress: (sub: Subscription) => void;
  onToggleStatus: (id: string) => void;
  onDelete: (id: string) => void;
  onAddFirstPress: () => void;
}

export const SubscriptionList: React.FC<SubscriptionListProps> = React.memo(
  ({
    subscriptions: _subscriptions,
    activeSubscriptions,
    upcomingSubscriptions,
    hasSubscriptions,
    hasActiveFilters,
    filteredCount,
    totalCount,
    onSubscriptionPress,
    onToggleStatus,
    onDelete,
    onAddFirstPress,
  }) => {
    usePerformanceProfiler('SubscriptionList', {
      activeCount: activeSubscriptions.length,
      upcomingCount: upcomingSubscriptions.length,
    });

    const renderItem = useCallback(
      ({ item }: { item: Subscription }) => (
        <SubscriptionCard
          subscription={item}
          onPress={onSubscriptionPress}
          onToggleStatus={onToggleStatus}
          onDelete={onDelete}
        />
      ),
      [onSubscriptionPress, onToggleStatus, onDelete]
    );

    const keyExtractor = useCallback((item: Subscription) => item.id, []);

    return (
      <View testID="subscription-list-root">
        {/* Upcoming Billing Section */}
        {upcomingSubscriptions && upcomingSubscriptions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              Upcoming Billing
            </Text>
            <Text style={styles.sectionSubtitle}>
              {upcomingSubscriptions.length} subscription
              {upcomingSubscriptions.length !== 1 ? 's' : ''} due this week
            </Text>
            <View style={styles.upcomingContainer} accessible={false}>
              {upcomingSubscriptions.slice(0, 3).map((subscription) => (
                <View
                  key={subscription.id}
                  style={styles.upcomingItem}
                  accessible={true}
                  accessibilityLabel={`${subscription.name}, due ${new Date(subscription.nextBillingDate).toLocaleDateString()}`}>
                  <Text
                    style={styles.upcomingName}
                    numberOfLines={1}
                    accessibilityElementsHidden={true}
                    importantForAccessibility="no">
                    {subscription.name}
                  </Text>
                  <Text
                    style={styles.upcomingDate}
                    accessibilityElementsHidden={true}
                    importantForAccessibility="no">
                    {new Date(subscription.nextBillingDate).toLocaleDateString()}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Main List Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              Your Subscriptions
            </Text>
            {hasSubscriptions && activeSubscriptions.length > 0 && (
              <View
                style={styles.sectionHeaderRight}
                accessibilityElementsHidden={true}
                importantForAccessibility="no">
                {hasActiveFilters && (
                  <Text style={styles.activeFiltersText}>
                    {filteredCount} of {totalCount}
                  </Text>
                )}
                <Text style={styles.subscriptionCount}>
                  {activeSubscriptions.length} subscription
                  {activeSubscriptions.length !== 1 ? 's' : ''}
                </Text>
              </View>
            )}
          </View>

          {!hasSubscriptions ? (
            /* Context 1: Absolute empty state (no tracking items exist) */
            <EmptyState
              icon="📱"
              title="No subscriptions yet"
              message="Add your first subscription to start tracking your automated expenses and recurring logs."
              actionText="Add Subscription"
              onAction={onAddFirstPress}
            />
          ) : activeSubscriptions.length === 0 ? (
            /* Context 2: Active filter empty state (subscriptions exist but filtered out) */
            <EmptyState
              icon="🔍"
              title="No matches found"
              message="No subscriptions correspond to your active filter or search query parameters."
            />
          ) : (
            <View style={styles.subscriptionsList}>
              <FlashList
                data={activeSubscriptions}
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                scrollEnabled={false}
                removeClippedSubviews
                showsVerticalScrollIndicator={false}
              />
            </View>
          )}
        </View>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  section: {
    padding: spacing.lg,
    paddingTop: 0,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionHeaderRight: {
    alignItems: 'flex-end',
  },
  activeFiltersText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  subscriptionCount: {
    ...typography.body,
    color: colors.textSecondary,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
  },
  sectionSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  upcomingContainer: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    ...shadows.sm,
  },
  upcomingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  upcomingName: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  upcomingDate: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '600',
  },
  subscriptionsList: {
    marginBottom: spacing.lg,
  },
});