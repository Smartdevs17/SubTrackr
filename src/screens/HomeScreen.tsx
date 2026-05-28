import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { colors, spacing, typography, borderRadius } from '../utils/constants';
import { useSubscriptionStore, useSettingsStore } from '../store';

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
  const { preferredCurrency, exchangeRates } = useSettingsStore();
  const [refreshing, setRefreshing] = useState(false);
  const [upcomingSubscriptions, setUpcomingSubscriptions] = useState<Subscription[]>([]);
  const [showFilterModal, setShowFilterModal] = useState(false);


  // Use the new hook
  const { filters, filteredAndSorted, activeFilterCount, hasActiveFilters, clearAllFilters } =
    useFilteredSubscriptions(subscriptions);

  const activeSubscriptions = useMemo(
    () => filteredAndSorted.filter((sub) => sub.isActive),
    [filteredAndSorted]
  );

  usePerformanceProfiler('HomeScreen', {
    subscriptions: subscriptions.length,
    filtered: filteredAndSorted.length,
  });

  useEffect(() => {
    calculateStats();
    if (subscriptions) setUpcomingSubscriptions(getUpcomingSubscriptions(subscriptions));
  }, [subscriptions, calculateStats, preferredCurrency, exchangeRates]);


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
          />
        }>
        {/* Header Section */}
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <View style={styles.titleContainer}>
              <Text style={styles.title} accessibilityRole="header">
                SubTrackr
              </Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('Gamification')}
                style={styles.levelBadge}>
                <Text style={styles.levelText}>Lvl {level}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.subtitle}>Manage your subscriptions</Text>
          </View>

          {/* Quick Actions/Tools Row */}
          <View style={styles.toolsRow}>
            <TouchableOpacity
              onPress={() => navigation.navigate('Community')}
              style={[styles.toolButton, { backgroundColor: colors.primary }]}>
              <Text style={styles.toolButtonText}>Community</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => navigation.navigate('SegmentManagement')}
              style={[styles.toolButton, { backgroundColor: colors.accent }]}>
              <Text style={styles.toolButtonText}>Segments</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => navigation.navigate('InvoiceList')}
              style={styles.toolButtonOutline}>
              <Text style={styles.toolButtonTextOutline}>Invoices</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => navigation.navigate('GroupManagement')}
              style={styles.toolButtonOutline}>
              <Text style={styles.toolButtonTextOutline}>Groups</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => navigation.navigate('SupportDashboard')}
              style={styles.toolButtonOutline}>
              <Text style={styles.toolButtonTextOutline}>Support</Text>
            </TouchableOpacity>
          </View>
        </View>

        <FilterBar
          searchQuery={filters.searchQuery}
          setSearchQuery={filters.setSearchQuery}
          onFilterPress={() => setShowFilterModal(true)}
          hasActiveFilters={hasActiveFilters}
          activeFilterCount={activeFilterCount}
        />

        <StatsCard
          totalMonthlySpend={stats.totalMonthlySpend}
          totalActive={stats.totalActive}
          onWalletPress={() => navigation.navigate('WalletConnect')}
          currency={preferredCurrency}
        />


        {!isOnline && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineText}>
              ⚠️ You are offline. {pendingTransactions} queued syncs pending.
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
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerTopRow: {
    marginBottom: spacing.md,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    ...typography.h1,
    color: colors.text,
  },
  levelBadge: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginLeft: spacing.sm,
  },
  levelText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  toolsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  toolButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    flex: 1,
    alignItems: 'center',
  },
  toolButtonOutline: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flex: 1,
    alignItems: 'center',
  },
  toolButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  toolButtonTextOutline: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 12,
  },
  offlineBanner: {
    backgroundColor: colors.error + '20', // Translucent red
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.error,
    alignItems: 'center',
  },
  offlineText: {
    ...typography.caption,
    color: colors.error,
    fontWeight: '600',
  },
});

export default HomeScreen;
