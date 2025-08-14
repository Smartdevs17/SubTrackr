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
  Switch
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, typography, borderRadius, shadows } from '../utils/constants';
import { useSubscriptionStore } from '../store';
import walletServiceManager from '../services/walletService';
import { SubscriptionCard } from '../components/subscription/SubscriptionCard';
import { FloatingActionButton } from '../components/common/FloatingActionButton';
import { formatCurrency, formatCurrencyCompact } from '../utils/formatting';
import { getUpcomingSubscriptions } from '../utils/dummyData';
import { Subscription, SubscriptionCategory, BillingCycle } from '../types/subscription';

const HomeScreen: React.FC = () => {
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

  // Filter helper functions
  const toggleCategory = (category: SubscriptionCategory) => {
    setSelectedCategories(prev => 
      prev.includes(category) 
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const toggleBillingCycle = (cycle: BillingCycle) => {
    setSelectedBillingCycles(prev => 
      prev.includes(cycle) 
        ? prev.filter(c => c !== cycle)
        : [...prev, cycle]
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
      filtered = filtered.filter(sub => 
        sub.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (sub.description && sub.description.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }
    
    // Category filter
    if (selectedCategories.length > 0) {
      filtered = filtered.filter(sub => selectedCategories.includes(sub.category));
    }
    
    // Billing cycle filter
    if (selectedBillingCycles.length > 0) {
      filtered = filtered.filter(sub => selectedBillingCycles.includes(sub.billingCycle));
    }
    
    // Price range filter
    filtered = filtered.filter(sub => 
      sub.price >= priceRange.min && sub.price <= priceRange.max
    );
    
    // Active status filter
    if (showActiveOnly) {
      filtered = filtered.filter(sub => sub.isActive);
    }
    
    // Crypto filter
    if (showCryptoOnly) {
      filtered = filtered.filter(sub => sub.isCryptoEnabled);
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
          comparison = new Date(a.nextBillingDate).getTime() - new Date(b.nextBillingDate).getTime();
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
    sortOrder
  ]);

  const activeSubscriptions = filteredAndSortedSubscriptions.filter(sub => sub.isActive);
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
          
          {/* Search and Filter Bar */}
          <View style={styles.searchFilterBar}>
            <View style={styles.searchContainer}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Search subscriptions..."
                placeholderTextColor={colors.textSecondary}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Text style={styles.clearSearchIcon}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
            
            <TouchableOpacity 
              style={[styles.filterButton, hasActiveFilters && styles.filterButtonActive]}
              onPress={() => setShowFilterModal(true)}
            >
              <Text style={styles.filterIcon}>🔧</Text>
              {hasActiveFilters && (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>{getActiveFilterCount()}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>
        
        {/* Stats Cards */}
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Total Monthly</Text>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
              {formatCurrencyCompact(stats.totalMonthlySpend)}
            </Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Active Subs</Text>
            <Text style={styles.statValue}>{stats.totalActive}</Text>
          </View>
          <View style={styles.statCard}>
            <TouchableOpacity onPress={() => navigation.navigate('WalletConnect' as never)}>
              <Text style={styles.statLabel}>Wallet</Text>
              <Text style={styles.statValue}>🔗</Text>
            </TouchableOpacity>
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
              <View style={styles.sectionHeaderRight}>
                {hasActiveFilters && (
                  <Text style={styles.activeFiltersText}>
                    {filteredAndSortedSubscriptions.length} of {subscriptions?.length || 0}
                  </Text>
                )}
                <Text style={styles.subscriptionCount}>
                  {activeSubscriptions.length} subscription{activeSubscriptions.length !== 1 ? 's' : ''}
                </Text>
              </View>
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

      {/* Filter Modal */}
      <Modal
        visible={showFilterModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowFilterModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Filter & Sort</Text>
            <TouchableOpacity onPress={() => setShowFilterModal(false)}>
              <Text style={styles.closeButton}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            {/* Categories */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Categories</Text>
              <View style={styles.categoryGrid}>
                {Object.values(SubscriptionCategory).map((category) => (
                  <TouchableOpacity
                    key={category}
                    style={[
                      styles.categoryChip,
                      selectedCategories.includes(category) && styles.categoryChipSelected
                    ]}
                    onPress={() => toggleCategory(category)}
                  >
                    <Text style={[
                      styles.categoryChipText,
                      selectedCategories.includes(category) && styles.categoryChipTextSelected
                    ]}>
                      {category.charAt(0).toUpperCase() + category.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Billing Cycles */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Billing Cycles</Text>
              <View style={styles.billingCycleGrid}>
                {Object.values(BillingCycle).map((cycle) => (
                  <TouchableOpacity
                    key={cycle}
                    style={[
                      styles.billingCycleChip,
                      selectedBillingCycles.includes(cycle) && styles.billingCycleChipSelected
                    ]}
                    onPress={() => toggleBillingCycle(cycle)}
                  >
                    <Text style={[
                      styles.billingCycleChipText,
                      selectedBillingCycles.includes(cycle) && styles.billingCycleChipTextSelected
                    ]}>
                      {cycle.charAt(0).toUpperCase() + cycle.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Price Range */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Price Range</Text>
              <View style={styles.priceRangeContainer}>
                <TextInput
                  style={styles.priceInput}
                  placeholder="Min"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="numeric"
                  value={priceRange.min.toString()}
                  onChangeText={(text) => setPriceRange(prev => ({ ...prev, min: parseFloat(text) || 0 }))}
                />
                <Text style={styles.priceRangeSeparator}>to</Text>
                <TextInput
                  style={styles.priceInput}
                  placeholder="Max"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="numeric"
                  value={priceRange.max.toString()}
                  onChangeText={(text) => setPriceRange(prev => ({ ...prev, max: parseFloat(text) || 1000 }))}
                />
              </View>
            </View>

            {/* Toggle Options */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Options</Text>
              <View style={styles.toggleContainer}>
                <Text style={styles.toggleLabel}>Active Only</Text>
                <Switch
                  value={showActiveOnly}
                  onValueChange={setShowActiveOnly}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.text}
                />
              </View>
              <View style={styles.toggleContainer}>
                <Text style={styles.toggleLabel}>Crypto Only</Text>
                <Switch
                  value={showCryptoOnly}
                  onValueChange={setShowCryptoOnly}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.text}
                />
              </View>
            </View>

            {/* Sort Options */}
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Sort By</Text>
              <View style={styles.sortContainer}>
                <View style={styles.sortRow}>
                  <Text style={styles.sortLabel}>Field:</Text>
                  <View style={styles.sortButtons}>
                    {(['name', 'price', 'nextBilling', 'category'] as const).map((field) => (
                      <TouchableOpacity
                        key={field}
                        style={[
                          styles.sortButton,
                          sortBy === field && styles.sortButtonSelected
                        ]}
                        onPress={() => setSortBy(field)}
                      >
                        <Text style={[
                          styles.sortButtonText,
                          sortBy === field && styles.sortButtonTextSelected
                        ]}>
                          {field === 'nextBilling' ? 'Next Billing' : field.charAt(0).toUpperCase() + field.slice(1)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                <View style={styles.sortRow}>
                  <Text style={styles.sortLabel}>Order:</Text>
                  <View style={styles.sortButtons}>
                    <TouchableOpacity
                      style={[
                        styles.sortButton,
                        sortOrder === 'asc' && styles.sortButtonSelected
                      ]}
                      onPress={() => setSortOrder('asc')}
                    >
                      <Text style={[
                        styles.sortButtonText,
                        sortOrder === 'asc' && styles.sortButtonTextSelected
                      ]}>
                        ↑ Ascending
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.sortButton,
                        sortOrder === 'desc' && styles.sortButtonSelected
                      ]}
                      onPress={() => setSortOrder('desc')}
                    >
                      <Text style={[
                        styles.sortButtonText,
                        sortOrder === 'desc' && styles.sortButtonTextSelected
                      ]}>
                        ↓ Descending
                      </Text>
                      </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          </ScrollView>

          {/* Modal Footer */}
          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.clearFiltersButton} onPress={clearAllFilters}>
              <Text style={styles.clearFiltersButtonText}>Clear All Filters</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.applyFiltersButton} onPress={() => setShowFilterModal(false)}>
              <Text style={styles.applyFiltersButtonText}>Apply Filters</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
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
  searchFilterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: spacing.sm,
    color: colors.textSecondary,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    ...typography.body,
  },
  clearSearchIcon: {
    fontSize: 16,
    color: colors.textSecondary,
    padding: spacing.xs,
  },
  filterButton: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  filterButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterIcon: {
    fontSize: 18,
    color: colors.text,
  },
  filterBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: colors.error,
    borderRadius: borderRadius.full,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  filterBadgeText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
    fontSize: 10,
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    ...typography.h2,
    color: colors.text,
  },
  closeButton: {
    fontSize: 24,
    color: colors.textSecondary,
    padding: spacing.sm,
  },
  modalContent: {
    flex: 1,
    padding: spacing.lg,
  },
  filterSection: {
    marginBottom: spacing.xl,
  },
  filterSectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.md,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  categoryChip: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryChipText: {
    ...typography.body,
    color: colors.text,
  },
  categoryChipTextSelected: {
    color: colors.text,
    fontWeight: '600',
  },
  billingCycleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  billingCycleChip: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  billingCycleChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  billingCycleChipText: {
    ...typography.body,
    color: colors.text,
  },
  billingCycleChipTextSelected: {
    color: colors.text,
    fontWeight: '600',
  },
  priceRangeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  priceInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    ...typography.body,
  },
  priceRangeSeparator: {
    ...typography.body,
    color: colors.textSecondary,
  },
  toggleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  toggleLabel: {
    ...typography.body,
    color: colors.text,
  },
  sortContainer: {
    gap: spacing.md,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  sortLabel: {
    ...typography.body,
    color: colors.text,
    minWidth: 80,
  },
  sortButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sortButton: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sortButtonSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  sortButtonText: {
    ...typography.body,
    color: colors.text,
  },
  sortButtonTextSelected: {
    color: colors.text,
    fontWeight: '600',
  },
  modalFooter: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  clearFiltersButton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  clearFiltersButtonText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  applyFiltersButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  applyFiltersButtonText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  statCard: {
    flex: 1,
    minWidth: 100,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 80,
    ...shadows.sm,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold' as const,
    color: colors.text,
    textAlign: 'center',
    lineHeight: 22,
    minHeight: 22,
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

export default HomeScreen;
