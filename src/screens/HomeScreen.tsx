import React, { useEffect, useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  SafeAreaView, 
  RefreshControl,
  TouchableOpacity,
  Alert
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, typography, borderRadius, shadows } from '../utils/constants';
import { useSubscriptionStore } from '../store';
import { SubscriptionCard } from '../components/subscription/SubscriptionCard';
import { FloatingActionButton } from '../components/common/FloatingActionButton';
import { formatCurrency } from '../utils/formatting';
import { getUpcomingSubscriptions } from '../utils/dummyData';
import { Subscription } from '../types/subscription';

export const HomeScreen: React.FC = () => {
  const navigation = useNavigation();
  const { 
    subscriptions, 
    stats, 
    isLoading, 
    error,
    fetchSubscriptions,
    calculateStats,
    toggleSubscriptionStatus 
  } = useSubscriptionStore();
  
  const [refreshing, setRefreshing] = useState(false);
  const [upcomingSubscriptions, setUpcomingSubscriptions] = useState<Subscription[]>([]);

  useEffect(() => {
    // Calculate stats when component mounts
    calculateStats();
    // Set up upcoming subscriptions
    if (subscriptions && Array.isArray(subscriptions)) {
      setUpcomingSubscriptions(getUpcomingSubscriptions(subscriptions));
    }
  }, [subscriptions, calculateStats]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchSubscriptions();
      setUpcomingSubscriptions(getUpcomingSubscriptions(subscriptions));
    } catch (error) {
      console.error('Failed to refresh:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSubscriptionPress = (subscription: Subscription) => {
    // TODO: Navigate to subscription detail screen
    Alert.alert(
      'Subscription Details',
      `Viewing details for ${subscription.name}`,
      [{ text: 'OK' }]
    );
  };

  const handleToggleStatus = async (id: string) => {
    try {
      await toggleSubscriptionStatus(id);
      setUpcomingSubscriptions(getUpcomingSubscriptions(subscriptions));
    } catch (error) {
      console.error('Failed to toggle subscription status:', error);
    }
  };

  const handleAddSubscription = () => {
    navigation.navigate('AddSubscription' as never);
  };

  const activeSubscriptions = subscriptions.filter(sub => sub.isActive);
  const hasSubscriptions = activeSubscriptions.length > 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView 
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>SubTrackr</Text>
          <Text style={styles.subtitle}>Manage your subscriptions</Text>
        </View>
        
        {/* Stats Cards */}
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Total Monthly</Text>
            <Text style={styles.statValue}>
              {formatCurrency(stats.totalMonthlySpend)}
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Active Subs</Text>
            <Text style={styles.statValue}>{stats.totalActive}</Text>
          </View>
        </View>
        
        {/* Upcoming Billing Section */}
        {upcomingSubscriptions && upcomingSubscriptions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Upcoming Billing</Text>
            <Text style={styles.sectionSubtitle}>
              {upcomingSubscriptions.length} subscription{upcomingSubscriptions.length !== 1 ? 's' : ''} due this week
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
        
        {/* Subscriptions List */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Your Subscriptions</Text>
            {hasSubscriptions && (
              <TouchableOpacity onPress={() => Alert.alert('Filter', 'Filter options coming soon')}>
                <Text style={styles.filterText}>Filter</Text>
              </TouchableOpacity>
            )}
          </View>
          
          {hasSubscriptions ? (
            <View style={styles.subscriptionsList}>
              {activeSubscriptions && activeSubscriptions.map((subscription) => (
                <SubscriptionCard
                  key={subscription.id}
                  subscription={subscription}
                  onPress={handleSubscriptionPress}
                  onToggleStatus={handleToggleStatus}
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
              <TouchableOpacity 
                style={styles.addFirstButton}
                onPress={handleAddSubscription}
              >
                <Text style={styles.addFirstButtonText}>Add Subscription</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        
        {/* Error Display */}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Error: {error}</Text>
          </View>
        )}
      </ScrollView>
      
      {/* Floating Action Button */}
      {hasSubscriptions && (
        <FloatingActionButton
          onPress={handleAddSubscription}
          icon="+"
          size="large"
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.h1,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    ...shadows.sm,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  statValue: {
    ...typography.h2,
    color: colors.text,
    fontWeight: 'bold',
  },
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
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
  },
  sectionSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  filterText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '500',
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
  errorContainer: {
    backgroundColor: colors.error,
    padding: spacing.md,
    margin: spacing.lg,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  errorText: {
    ...typography.body,
    color: colors.text,
    textAlign: 'center',
  },
});
