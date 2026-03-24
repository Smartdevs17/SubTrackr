import { useState, useMemo } from 'react';
import { Subscription, SubscriptionCategory, BillingCycle } from '../types/subscription';

export const useSubscriptionFilters = (subscriptions: Subscription[]) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<SubscriptionCategory[]>([]);
  const [selectedBillingCycles, setSelectedBillingCycles] = useState<BillingCycle[]>([]);
  const [priceRange, setPriceRange] = useState({ min: 0, max: 1000 });
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [showCryptoOnly, setShowCryptoOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'price' | 'nextBilling' | 'category'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const filteredAndSorted = useMemo(() => {
    let filtered = subscriptions || [];

    if (searchQuery.trim()) {
      filtered = filtered.filter(sub => 
        sub.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        sub.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (selectedCategories.length > 0) {
      filtered = filtered.filter(sub => selectedCategories.includes(sub.category));
    }

    if (selectedBillingCycles.length > 0) {
      filtered = filtered.filter(sub => selectedBillingCycles.includes(sub.billingCycle));
    }

    filtered = filtered.filter(sub => sub.price >= priceRange.min && sub.price <= priceRange.max);
    if (showActiveOnly) filtered = filtered.filter(sub => sub.isActive);
    if (showCryptoOnly) filtered = filtered.filter(sub => sub.isCryptoEnabled);

    return [...filtered].sort((a, b) => {
      let comp = 0;
      switch (sortBy) {
        case 'name': comp = a.name.localeCompare(b.name); break;
        case 'price': comp = a.price - b.price; break;
        case 'nextBilling': comp = new Date(a.nextBillingDate).getTime() - new Date(b.nextBillingDate).getTime(); break;
        case 'category': comp = a.category.localeCompare(b.category); break;
      }
      return sortOrder === 'asc' ? comp : -comp;
    });
  }, [subscriptions, searchQuery, selectedCategories, selectedBillingCycles, priceRange, showActiveOnly, showCryptoOnly, sortBy, sortOrder]);

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
  }, [searchQuery, selectedCategories, selectedBillingCycles, priceRange, showActiveOnly, showCryptoOnly, sortBy, sortOrder]);

  return {
    filters: {
      searchQuery, setSearchQuery,
      selectedCategories, setSelectedCategories,
      selectedBillingCycles, setSelectedBillingCycles,
      priceRange, setPriceRange,
      showActiveOnly, setShowActiveOnly,
      showCryptoOnly, setShowCryptoOnly,
      sortBy, setSortBy,
      sortOrder, setSortOrder,
    },
    filteredAndSorted,
    activeFilterCount,
    hasActiveFilters: activeFilterCount > 0,
    clearAllFilters: () => {
      setSearchQuery('');
      setSelectedCategories([]);
      setSelectedBillingCycles([]);
      setPriceRange({ min: 0, max: 1000 });
      setShowActiveOnly(true);
      setShowCryptoOnly(false);
      setSortBy('name');
      setSortOrder('asc');
    }
  };
};