import { useCallback, useEffect, useMemo, type SetStateAction } from 'react';
import { useAtomicState, resolveAtomicValue } from './useAtomicState';
import { useDebounce } from './useDebounce';
import { Subscription, SubscriptionCategory, BillingCycle } from '../types/subscription';

interface FilterState {
  searchQuery: string;
  selectedCategories: SubscriptionCategory[];
  selectedBillingCycles: BillingCycle[];
  priceRange: { min: number; max: number };
  showActiveOnly: boolean;
  showCryptoOnly: boolean;
  sortBy: 'name' | 'price' | 'nextBilling' | 'category';
  sortOrder: 'asc' | 'desc';
}

const DEFAULT_FILTERS: FilterState = {
  searchQuery: '',
  selectedCategories: [],
  selectedBillingCycles: [],
  priceRange: { min: 0, max: 1000 },
  showActiveOnly: true,
  showCryptoOnly: false,
  sortBy: 'name',
  sortOrder: 'asc',
};

export const useSubscriptionFilters = (subscriptions: Subscription[]) => {
  const [state, patchState, resetState] = useAtomicState<FilterState>(DEFAULT_FILTERS);
  const {
    searchQuery,
    selectedCategories,
    selectedBillingCycles,
    priceRange,
    showActiveOnly,
    showCryptoOnly,
    sortBy,
    sortOrder,
  } = state;

  const setters = useMemo(
    () => ({
      setSearchQuery: (value: SetStateAction<string>) =>
        patchState((prev) => ({ searchQuery: resolveAtomicValue(value, prev.searchQuery) })),
      setSelectedCategories: (value: SetStateAction<SubscriptionCategory[]>) =>
        patchState((prev) => ({
          selectedCategories: resolveAtomicValue(value, prev.selectedCategories),
        })),
      setSelectedBillingCycles: (value: SetStateAction<BillingCycle[]>) =>
        patchState((prev) => ({
          selectedBillingCycles: resolveAtomicValue(value, prev.selectedBillingCycles),
        })),
      setPriceRange: (value: SetStateAction<FilterState['priceRange']>) =>
        patchState((prev) => ({ priceRange: resolveAtomicValue(value, prev.priceRange) })),
      setShowActiveOnly: (value: SetStateAction<boolean>) =>
        patchState((prev) => ({ showActiveOnly: resolveAtomicValue(value, prev.showActiveOnly) })),
      setShowCryptoOnly: (value: SetStateAction<boolean>) =>
        patchState((prev) => ({ showCryptoOnly: resolveAtomicValue(value, prev.showCryptoOnly) })),
      setSortBy: (value: SetStateAction<FilterState['sortBy']>) =>
        patchState((prev) => ({ sortBy: resolveAtomicValue(value, prev.sortBy) })),
      setSortOrder: (value: SetStateAction<FilterState['sortOrder']>) =>
        patchState((prev) => ({ sortOrder: resolveAtomicValue(value, prev.sortOrder) })),
    }),
    [patchState]
  );

  const filters = useMemo(
    () => ({
      searchQuery,
      setSearchQuery: setters.setSearchQuery,
      selectedCategories,
      setSelectedCategories: setters.setSelectedCategories,
      selectedBillingCycles,
      setSelectedBillingCycles: setters.setSelectedBillingCycles,
      priceRange,
      setPriceRange: setters.setPriceRange,
      showActiveOnly,
      setShowActiveOnly: setters.setShowActiveOnly,
      showCryptoOnly,
      setShowCryptoOnly: setters.setShowCryptoOnly,
      sortBy,
      setSortBy: setters.setSortBy,
      sortOrder,
      setSortOrder: setters.setSortOrder,
    }),
    [
      searchQuery,
      selectedCategories,
      selectedBillingCycles,
      priceRange,
      showActiveOnly,
      showCryptoOnly,
      sortBy,
      sortOrder,
      setters,
    ]
  );

  const debouncedSearchQuery = useDebounce(searchQuery);
  const normalizedSearch = useMemo(
    () => debouncedSearchQuery.trim().toLowerCase(),
    [debouncedSearchQuery]
  );

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

  const searchedSubscriptions = useMemo(
    () => (subscriptions || []).filter(matchesSearch),
    [subscriptions, matchesSearch]
  );

  const categoryFilteredSubscriptions = useMemo(
    () => searchedSubscriptions.filter(matchesCategory),
    [searchedSubscriptions, matchesCategory]
  );

  const billingCycleFilteredSubscriptions = useMemo(
    () => categoryFilteredSubscriptions.filter(matchesBillingCycle),
    [categoryFilteredSubscriptions, matchesBillingCycle]
  );

  const priceFilteredSubscriptions = useMemo(
    () => billingCycleFilteredSubscriptions.filter(matchesPriceRange),
    [billingCycleFilteredSubscriptions, matchesPriceRange]
  );

  const activeFilteredSubscriptions = useMemo(
    () => priceFilteredSubscriptions.filter(matchesActiveOnly),
    [priceFilteredSubscriptions, matchesActiveOnly]
  );

  const cryptoFilteredSubscriptions = useMemo(
    () => activeFilteredSubscriptions.filter(matchesCryptoOnly),
    [activeFilteredSubscriptions, matchesCryptoOnly]
  );

  const filteredAndSorted = useMemo(
    () => [...cryptoFilteredSubscriptions].sort(comparator),
    [cryptoFilteredSubscriptions, comparator]
  );

  useEffect(() => {
    if (typeof __DEV__ !== 'undefined' && __DEV__ && (subscriptions?.length ?? 0) >= 200) {
      console.debug('[useSubscriptionFilters] recalculated', {
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
    filters,
    filteredAndSorted,
    activeFilterCount,
    hasActiveFilters: activeFilterCount > 0,
    clearAllFilters: resetState,
  };
};
