import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, RefreshControl, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useSubscriptionStore } from '../store';
import { getUpcomingSubscriptions } from '../utils/dummyData';
import { Subscription } from '../types/subscription';
import { RootStackParamList } from '../navigation/types';
import { useGamificationStore } from '../store/gamificationStore';
import { useTransactionQueueStore } from '../store/transactionQueueStore';
import { usePerformanceProfiler } from '../hooks/usePerformanceProfiler';

// Components
import { FloatingActionButton } from '../components/common/FloatingActionButton';
import { useFilteredSubscriptions } from '../hooks/useFilteredSubscriptions';
import { FilterBar } from '../components/home/FilterBar';
import { FilterModal } from '../components/home/FilterModal';
import { StatsCard } from '../components/home/StatsCard';
import { SubscriptionList } from '../components/home/SubscriptionList';

type HomeNavigationProp = NativeStackNavigationProp<RootStackParamList>;

const HomeScreen: React.FC = () => {
  const navigation = useNavigation<HomeNavigationProp>();
  const { subscriptions, stats, fetchSubscriptions, calculateStats, toggleSubscriptionStatus } =
    useSubscriptionStore();
  const isOnline = useTransactionQueueStore((state) => state.isOnline);
  const pendingTransactions = useTransactionQueueStore((state) => state.queuedTransactions.length);
  const { level } = useGamificationStore();
  const [refreshing, setRefreshing] = useState(false);
  const [upcomingSubscriptions, setUpcomingSubscriptions] = useState<Subscription[]>([]);

  // Use the new hook
  const { filters, filteredAndSorted, activeFilterCount, hasActiveFilters, clearAllFilters } =
    useFilteredSubscriptions(subscriptions);
  const activeSubscriptions = useMemo(
    () => filteredAndSorted.filter((subscription) => subscription.isActive),
    [filteredAndSorted]
  );
  const [showFilterModal, setShowFilterModal] = useState(false);

  usePerformanceProfiler('HomeScreen', {
    subscriptions: subscriptions.length,
    filtered: filteredAndSorted.length,
  });

  useEffect(() => {
    calculateStats();
    if (subscriptions) setUpcomingSubscriptions(getUpcomingSubscriptions(subscriptions));
  }, [subscriptions, calculateStats]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchSubscriptions();
    setRefreshing(false);
  };

  const handleToggleStatus = async (id: string) => {
    await toggleSubscriptionStatus(id);
  };

  return (
    <SafeAreaView
      style={styles.container}
      accessibilityLabel="SubTrackr home screen"
      testID="home-screen">
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            accessibilityLabel={refreshing ? 'Refreshing subscriptions' : 'Pull to refresh'}
          />
        }>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.title} accessibilityRole="header">
                  SubTrackr
                </Text>
                <TouchableOpacity 
                  onPress={() => navigation.navigate('Gamification')}
                  style={{ backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 10 }}
                >
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>Lvl {level}</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.subtitle}>Manage your subscriptions</Text>
            </View>
            <TouchableOpacity
              onPress={() => navigation.navigate('SegmentManagement')}
              style={{ backgroundColor: colors.accent, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>Segments</Text>
            </TouchableOpacity>
          </View>
          <FilterBar
            searchQuery={filters.searchQuery}
            setSearchQuery={filters.setSearchQuery}
            onFilterPress={() => setShowFilterModal(true)}
            hasActiveFilters={hasActiveFilters}
            activeFilterCount={activeFilterCount}
          />
        </View>

        <StatsCard
          totalMonthlySpend={stats.totalMonthlySpend}
          totalActive={stats.totalActive}
          onWalletPress={() => navigation.navigate('WalletConnect')}
        />

        {!isOnline && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>
              You are offline. {pendingTransactions} queued transaction
              {pendingTransactions === 1 ? '' : 's'} will sync when back online.
            </Text>
          </View>
        )}

        <SubscriptionList
          subscriptions={subscriptions}
          activeSubscriptions={activeSubscriptions}
          upcomingSubscriptions={upcomingSubscriptions}
          hasSubscriptions={subscriptions.length > 0}
          hasActiveFilters={hasActiveFilters}
          filteredCount={filteredAndSorted.length}
          totalCount={subscriptions.length}
          onSubscriptionPress={(sub) => navigation.navigate('SubscriptionDetail', { id: sub.id })}
          onToggleStatus={handleToggleStatus}
          onAddFirstPress={() => navigation.navigate('AddSubscription')}
        />
      </ScrollView>

      {subscriptions.length > 0 && (
        <FloatingActionButton
          onPress={() => navigation.navigate('AddSubscription')}
          icon="+"
          size="large"
          testID="add-subscription-button"
        />
      )}

      <FilterModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        {...filters}
        clearAllFilters={clearAllFilters}
        toggleCategory={(cat) =>
          filters.setSelectedCategories((prev) =>
            prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
          )
        }
        toggleBillingCycle={(cycle) =>
          filters.setSelectedBillingCycles((prev) =>
            prev.includes(cycle) ? prev.filter((c) => c !== cycle) : [...prev, cycle]
          )
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollView: { flex: 1 },
  header: { padding: spacing.lg, paddingBottom: spacing.md },
  title: { ...typography.h1, color: colors.text, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary },
  errorContainer: {
    backgroundColor: colors.error,
    padding: spacing.md,
    margin: spacing.lg,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  errorText: { ...typography.body, color: colors.text },
});

export default HomeScreen;
