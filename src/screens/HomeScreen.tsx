import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useSubscriptionStore } from '../store';
import { getUpcomingSubscriptions } from '../utils/dummyData';
import { Subscription } from '../types/subscription';
import { RootStackParamList } from '../navigation/types';

// Components
import { FloatingActionButton } from '../components/common/FloatingActionButton';
import { useSubscriptionFilters } from '../hooks/useSubscriptionFilters';
import { FilterBar } from '../components/home/FilterBar';
import { FilterModal } from '../components/home/FilterModal';
import { StatsCard } from '../components/home/StatsCard';
import { SubscriptionList } from '../components/home/SubscriptionList';

type HomeNavigationProp = NativeStackNavigationProp<RootStackParamList>;

const HomeScreen: React.FC = () => {
  const navigation = useNavigation<HomeNavigationProp>();
  const { subscriptions, stats, fetchSubscriptions, calculateStats, toggleSubscriptionStatus } =
    useSubscriptionStore();
  const [refreshing, setRefreshing] = useState(false);
  const [upcomingSubscriptions, setUpcomingSubscriptions] = useState<Subscription[]>([]);

  // Use the new hook
  const { filters, filteredAndSorted, activeFilterCount, hasActiveFilters, clearAllFilters } =
    useSubscriptionFilters(subscriptions);
  const [showFilterModal, setShowFilterModal] = useState(false);

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
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }>
        <View style={styles.header}>
          <Text style={styles.title}>SubTrackr</Text>
          <Text style={styles.subtitle}>Manage your subscriptions</Text>
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

        <SubscriptionList
          subscriptions={subscriptions}
          activeSubscriptions={filteredAndSorted.filter((s) => s.isActive)}
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
