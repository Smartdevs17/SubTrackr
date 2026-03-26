import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, typography, borderRadius, shadows } from '../../utils/constants';
import { SubscriptionCard } from '../subscription/SubscriptionCard';
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
  return (
    <View>
      {/* Upcoming Billing Section */}
      {upcomingSubscriptions && upcomingSubscriptions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Upcoming Billing</Text>
          <Text style={styles.sectionSubtitle}>
            {upcomingSubscriptions.length} subscription
            {upcomingSubscriptions.length !== 1 ? 's' : ''} due this week
          </Text>
          <View style={styles.upcomingContainer}>
            {upcomingSubscriptions.slice(0, 3).map((subscription) => (
              <View key={subscription.id} style={styles.upcomingItem}>
                <Text style={styles.upcomingName} numberOfLines={1}>
                  {subscription.name}
                </Text>
                <Text style={styles.upcomingDate}>
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
          <Text style={styles.sectionTitle}>Your Subscriptions</Text>
          {hasSubscriptions && (
            <View style={styles.sectionHeaderRight}>
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

        {hasSubscriptions ? (
          <View style={styles.subscriptionsList}>
            {activeSubscriptions.map((subscription) => (
              <SubscriptionCard
                key={subscription.id}
                subscription={subscription}
                onPress={onSubscriptionPress}
                onToggleStatus={onToggleStatus}
              />
            ))}
          </View>
        ) : (
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
        )}
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
