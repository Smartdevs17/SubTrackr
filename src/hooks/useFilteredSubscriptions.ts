import { useState, useMemo, useCallback } from 'react';
import { Subscription, SubscriptionCategory, BillingCycle } from '../types/subscription';

export const useFilteredSubscriptions = (subscriptions: Subscription[]) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<SubscriptionCategory[]>([]);
  const [selectedBillingCycles, setSelectedBillingCycles] = useState<BillingCycle[]>([]);
  const [priceRange, setPriceRange] = useState({ min: 0, max: 1000 });
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [showCryptoOnly, setShowCryptoOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'price' | 'nextBilling' | 'category'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const normalizedSearch = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);

  const matchesSearch = useCallback(
    (sub: Subscription): boolean => {
      if (!normalizedSearch) return true;
      return (
        sub.name.toLowerCase().includes(normalizedSearch) ||
        sub.description?.toLowerCase().includes(normalizedSearch) === true
      );
    },
    [normalizedSearch]
  );

  const matchesCategory = useCallback(
    (sub: Subscription): boolean => {
      if (selectedCategories.length === 0) return true;
      return selectedCategories.includes(sub.category);
    },
    [selectedCategories]
  );

  const matchesBillingCycle = useCallback(
    (sub: Subscription): boolean => {
      if (selectedBillingCycles.length === 0) return true;
      return selectedBillingCycles.includes(sub.billingCycle);
    },
    [selectedBillingCycles]
  );

  const matchesPriceRange = useCallback(
    (sub: Subscription): boolean => sub.price >= priceRange.min && sub.price <= priceRange.max,
    [priceRange.max, priceRange.min]
  );

  const matchesActiveOnly = useCallback(
    (sub: Subscription): boolean => !showActiveOnly || sub.isActive,
    [showActiveOnly]
  );

  const matchesCryptoOnly = useCallback(
    (sub: Subscription): boolean => !showCryptoOnly || sub.isCryptoEnabled,
    [showCryptoOnly]
  );

  const comparator = useCallback(
    (a: Subscription, b: Subscription): number => {
      let comp = 0;
      switch (sortBy) {
        case 'name':
          comp = a.name.localeCompare(b.name);
          break;
        case 'price':
          comp = a.price - b.price;
          break;
        case 'nextBilling':
          comp = new Date(a.nextBillingDate).getTime() - new Date(b.nextBillingDate).getTime();
          break;
        case 'category':
          comp = a.category.localeCompare(b.category);
          break;
      }
      return sortOrder === 'asc' ? comp : -comp;
    },
    [sortBy, sortOrder]
  );

  const filteredAndSorted = useMemo(() => {
    const source = subscriptions || [];
    const filtered = source.filter(
      (sub) =>
        matchesSearch(sub) &&
        matchesCategory(sub) &&
        matchesBillingCycle(sub) &&
        matchesPriceRange(sub) &&
        matchesActiveOnly(sub) &&
        matchesCryptoOnly(sub)
    );

    return filtered.sort(comparator);
  }, [
    subscriptions,
    matchesSearch,
    matchesCategory,
    matchesBillingCycle,
    matchesPriceRange,
    matchesActiveOnly,
    matchesCryptoOnly,
    comparator,
  ]);

  const clearAllFilters = useCallback(() => {
    setSearchQuery('');
    setSelectedCategories([]);
    setSelectedBillingCycles([]);
    setPriceRange({ min: 0, max: 1000 });
    setShowActiveOnly(true);
    setShowCryptoOnly(false);
    setSortBy('name');
    setSortOrder('asc');
  }, []);

  // Basic in-dev profiling: logs expensive filter passes on large lists.
  useMemo(() => {
    if (__DEV__ && (subscriptions?.length ?? 0) >= 200) {
      console.debug('[useFilteredSubscriptions] recalculated', {
        total: subscriptions.length,
        filtered: filteredAndSorted.length,
      });
    }
  }, [subscriptions, filteredAndSorted.length]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (searchQuery.trim()) count++;
    if (selectedCategories.length > 0) count++;
    if (selectedBillingCycles.length > 0) count++;
    if (priceRange.min > 0 || priceRange.max < 1000) count++;
    if (!showActiveOnly) count++;
    if (showCryptoOnly) count++;
    if (sortBy !== 'name' || sortOrder !== 'asc') count++;
    return count;
  }, [
    searchQuery,
    selectedCategories,
    selectedBillingCycles,
    priceRange,
    showActiveOnly,
    showCryptoOnly,
    sortBy,
    sortOrder,
  ]);

  return {
    filters: {
      searchQuery,
      setSearchQuery,
      selectedCategories,
      setSelectedCategories,
      selectedBillingCycles,
      setSelectedBillingCycles,
      priceRange,
      setPriceRange,
      showActiveOnly,
      setShowActiveOnly,
      showCryptoOnly,
      setShowCryptoOnly,
      sortBy,
      setSortBy,
      sortOrder,
      setSortOrder,
    },
    filteredAndSorted,
    activeFilterCount,
    hasActiveFilters: activeFilterCount > 0,
    clearAllFilters,
  };
};
