import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing, typography, borderRadius, shadows } from '../utils/constants';
import { useSubscriptionStore } from '../store';
import walletServiceManager from '../services/walletService';
import { SubscriptionCard } from '../components/subscription/SubscriptionCard';
import { FloatingActionButton } from '../components/common/FloatingActionButton';
import { formatCurrency, formatCurrencyCompact } from '../utils/formatting';
import { getUpcomingSubscriptions } from '../utils/dummyData';
import { Subscription, SubscriptionCategory, BillingCycle } from '../types/subscription';
import { RootStackParamList } from '../navigation/types';

// Home Components
import { StatsCard } from '../components/home/StatsCard';
import { FilterBar } from '../components/home/FilterBar';
import { FilterModal } from '../components/home/FilterModal';
import { SubscriptionList } from '../components/home/SubscriptionList';

type HomeNavigationProp = NativeStackNavigationProp<RootStackParamList>;

const HomeScreen: React.FC = () => {
  const navigation = useNavigation<HomeNavigationProp>();
  const {
    subscriptions,
    stats,
    isLoading,
    error,
    fetchSubscriptions,
    calculateStats,
    toggleSubscriptionStatus,
  } = useSubscriptionStore();

  const [refreshing, setRefreshing] = useState(false);
  const [upcomingSubscriptions, setUpcomingSubscriptions] = useState<Subscription[]>([]);

  // Filter state
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<SubscriptionCategory[]>([]);
  const [selectedBillingCycles, setSelectedBillingCycles] = useState<BillingCycle[]>([]);
  const [priceRange, setPriceRange] = useState({ min: 0, max: 1000 });
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [showCryptoOnly, setShowCryptoOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'price' | 'nextBilling' | 'category'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

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
    navigation.navigate('SubscriptionDetail', { id: subscription.id });
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

  // Filter helper functions
  const toggleCategory = (category: SubscriptionCategory) => {
    setSelectedCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
    );
  };

  const toggleBillingCycle = (cycle: BillingCycle) => {
    setSelectedBillingCycles((prev) =>
      prev.includes(cycle) ? prev.filter((c) => c !== cycle) : [...prev, cycle]
    );
  };

  const clearAllFilters = () => {
    setSearchQuery('');
    setSelectedCategories([]);
    setSelectedBillingCycles([]);
    setPriceRange({ min: 0, max: 1000 });
    setShowActiveOnly(true);
    setShowCryptoOnly(false);
    setSortBy('name');
    setSortOrder('asc');
  };

  const getActiveFilterCount = () => {
    let count = 0;
    if (searchQuery.trim()) count++;
    if (selectedCategories.length > 0) count++;
    if (selectedBillingCycles.length > 0) count++;
    if (priceRange.min > 0 || priceRange.max < 1000) count++;
    if (!showActiveOnly) count++;
    if (showCryptoOnly) count++;
    if (sortBy !== 'name' || sortOrder !== 'asc') count++;
    return count;
  };

  const hasActiveFilters = getActiveFilterCount() > 0;

  // Filter and sort subscriptions
  const filteredAndSortedSubscriptions = useMemo(() => {
    let filtered = subscriptions || [];

    // Search filter
    if (searchQuery.trim()) {
      filtered = filtered.filter(
        (sub) =>
          sub.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (sub.description && sub.description.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }

    // Category filter
    if (selectedCategories.length > 0) {
      filtered = filtered.filter((sub) => selectedCategories.includes(sub.category));
    }

    // Billing cycle filter
    if (selectedBillingCycles.length > 0) {
      filtered = filtered.filter((sub) => selectedBillingCycles.includes(sub.billingCycle));
    }

    // Price range filter
    filtered = filtered.filter((sub) => sub.price >= priceRange.min && sub.price <= priceRange.max);

    // Active status filter
    if (showActiveOnly) {
      filtered = filtered.filter((sub) => sub.isActive);
    }

    // Crypto filter
    if (showCryptoOnly) {
      filtered = filtered.filter((sub) => sub.isCryptoEnabled);
    }

    // Sort subscriptions
    filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'price':
          comparison = a.price - b.price;
          break;
        case 'nextBilling':
          comparison =
            new Date(a.nextBillingDate).getTime() - new Date(b.nextBillingDate).getTime();
          break;
        case 'category':
          comparison = a.category.localeCompare(b.category);
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [
    subscriptions,
    searchQuery,
    selectedCategories,
    selectedBillingCycles,
    priceRange,
    showActiveOnly,
    showCryptoOnly,
    sortBy,
    sortOrder,
  ]);

  const activeSubscriptions = filteredAndSortedSubscriptions.filter((sub) => sub.isActive);
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
        }>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>SubTrackr</Text>
          <Text style={styles.subtitle}>Manage your subscriptions</Text>

          {/* Search and Filter Bar */}
          <FilterBar
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onFilterPress={() => setShowFilterModal(true)}
            hasActiveFilters={hasActiveFilters}
            activeFilterCount={getActiveFilterCount()}
          />
        </View>

        {/* Stats Cards */}
       <StatsCard 
          totalMonthlySpend={stats.totalMonthlySpend}
          totalActive={stats.totalActive}
          onWalletPress={() => navigation.navigate('WalletConnect' as never)}
        />

        {/* Upcoming Billing Section */}
       <SubscriptionList
          subscriptions={subscriptions}
          activeSubscriptions={activeSubscriptions}
          upcomingSubscriptions={upcomingSubscriptions}
          hasSubscriptions={hasSubscriptions}
          hasActiveFilters={hasActiveFilters}
          filteredCount={filteredAndSortedSubscriptions.length}
          totalCount={subscriptions?.length || 0}
          onSubscriptionPress={handleSubscriptionPress}
          onToggleStatus={handleToggleStatus}
          onAddFirstPress={handleAddSubscription}
        />

        {/* Error Display */}
        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Error: {error}</Text>
          </View>
        )}
      </ScrollView>

      {/* Floating Action Button */}
      {hasSubscriptions && (
        <FloatingActionButton onPress={handleAddSubscription} icon="+" size="large" />
      )}

      {/* Filter Modal */}
     <FilterModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        selectedCategories={selectedCategories}
        toggleCategory={toggleCategory}
        selectedBillingCycles={selectedBillingCycles}
        toggleBillingCycle={toggleBillingCycle}
        priceRange={priceRange}
        setPriceRange={setPriceRange}
        showActiveOnly={showActiveOnly}
        setShowActiveOnly={setShowActiveOnly}
        showCryptoOnly={showCryptoOnly}
        setShowCryptoOnly={setShowCryptoOnly}
        sortBy={sortBy}
        setSortBy={setSortBy}
        sortOrder={sortOrder}
        setSortOrder={setSortOrder}
        clearAllFilters={clearAllFilters}
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

export default HomeScreen;
