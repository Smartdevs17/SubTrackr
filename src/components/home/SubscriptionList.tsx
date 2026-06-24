import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, typography, borderRadius } from '../../utils/constants';
import { SubscriptionListItem } from '../common/SubscriptionListItem';
import { OptimizedFlatList } from '../common/OptimizedFlatList';
import { Subscription } from '../../types/subscription';

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
  onAddFirstPress: () => void;
}

const UPCOMING_ITEM_HEIGHT = 48;

export const SubscriptionList: React.FC<SubscriptionListProps> = ({
  subscriptions: _subscriptions,
  activeSubscriptions,
  upcomingSubscriptions,
  hasSubscriptions,
  hasActiveFilters,
  filteredCount,
  totalCount,
  onSubscriptionPress,
  onToggleStatus,
  onAddFirstPress,
}) => {
  const sortedUpcoming = useMemo(
    () =>
      upcomingSubscriptions
        ?.slice()
        .sort(
          (a, b) => new Date(a.nextBillingDate).getTime() - new Date(b.nextBillingDate).getTime()
        ) ?? [],
    [upcomingSubscriptions]
  );

  const topUpcoming = useMemo(() => sortedUpcoming.slice(0, 3), [sortedUpcoming]);

  const renderSubscriptionItem = useMemo(
    () =>
      ({ item }: { item: Subscription }) => (
        <SubscriptionListItem
          subscription={item}
          onPress={onSubscriptionPress}
          onToggleStatus={onToggleStatus}
        />
      ),
    [onSubscriptionPress, onToggleStatus]
  );

  const subscriptionKeyExtractor = useMemo(() => (item: Subscription) => item.id, []);

  const activeLabel = useMemo(
    () =>
      `${activeSubscriptions.length} subscription${activeSubscriptions.length !== 1 ? 's' : ''}`,
    [activeSubscriptions.length]
  );

  const upcomingKeyExtractor = (item: Subscription) => `upcoming-${item.id}`;

  if (!hasSubscriptions) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>📱</Text>
        <Text style={styles.emptyText}>No subscriptions yet</Text>
        <Text style={styles.emptySubtext}>
          Add your first subscription to start tracking your spending
        </Text>
        <TouchableOpacity style={styles.addFirstButton} onPress={onAddFirstPress}>
          <Text style={styles.addFirstButtonText}>Add Subscription</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      {topUpcoming.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Upcoming Billing</Text>
          <Text style={styles.sectionSubtitle}>
            {sortedUpcoming.length} subscription{sortedUpcoming.length !== 1 ? 's' : ''} due this
            week
          </Text>
          <View style={styles.upcomingContainer}>
            <OptimizedFlatList
              data={topUpcoming}
              renderItem={({ item }) => (
                <View style={styles.upcomingItem}>
                  <Text style={styles.upcomingName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.upcomingDate}>
                    {new Date(item.nextBillingDate).toLocaleDateString()}
                  </Text>
                </View>
              )}
              keyExtractor={upcomingKeyExtractor}
              estimatedItemSize={UPCOMING_ITEM_HEIGHT}
              scrollEnabled={false}
            />
          </View>
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Your Subscriptions</Text>
          <View style={styles.sectionHeaderRight}>
            {hasActiveFilters && (
              <Text style={styles.activeFiltersText}>
                {filteredCount} of {totalCount}
              </Text>
            )}
            <Text style={styles.subscriptionCount}>{activeLabel}</Text>
          </View>
        </View>
        <OptimizedFlatList
          data={activeSubscriptions}
          renderItem={renderSubscriptionItem}
          keyExtractor={subscriptionKeyExtractor}
          estimatedItemSize={84}
          scrollEnabled={false}
        />
      </View>
    </View>
  );
};

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
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyText: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  emptySubtext: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
    lineHeight: 22,
  },
  addFirstButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
  },
  addFirstButtonText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
});
