import { renderHook, act } from '@testing-library/react-hooks';
import { useFilteredSubscriptions } from '../useFilteredSubscriptions';
import { Subscription, SubscriptionCategory, BillingCycle } from '../../types/subscription';

describe('useFilteredSubscriptions', () => {
  const mockSubscriptions: Subscription[] = [
    {
      id: '1',
      name: 'Netflix',
      description: 'Streaming service',
      category: SubscriptionCategory.STREAMING,
      price: 15.99,
      currency: 'USD',
      billingCycle: BillingCycle.MONTHLY,
      nextBillingDate: new Date('2024-02-01'),
      isActive: true,
      isCryptoEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: '2',
      name: 'Spotify',
      description: 'Music streaming',
      category: SubscriptionCategory.STREAMING,
      price: 9.99,
      currency: 'USD',
      billingCycle: BillingCycle.MONTHLY,
      nextBillingDate: new Date('2024-02-15'),
      isActive: true,
      isCryptoEnabled: true,
      cryptoStreamId: 'stream-123',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: '3',
      name: 'Adobe Creative Cloud',
      description: 'Design software',
      category: SubscriptionCategory.SOFTWARE,
      price: 599.99,
      currency: 'USD',
      billingCycle: BillingCycle.YEARLY,
      nextBillingDate: new Date('2024-03-01'),
      isActive: false,
      isCryptoEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  it('should return all subscriptions when no filters are applied', () => {
    const { result } = renderHook(() => useFilteredSubscriptions(mockSubscriptions));

    expect(result.current.filteredAndSorted).toHaveLength(2);
    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.activeFilterCount).toBe(0);
  });

  it('should filter by search query', () => {
    const { result } = renderHook(() => useFilteredSubscriptions(mockSubscriptions));

    act(() => {
      result.current.filters.setSearchQuery('Netflix');
    });

    expect(result.current.filteredAndSorted).toHaveLength(1);
    expect(result.current.filteredAndSorted[0].name).toBe('Netflix');
    expect(result.current.hasActiveFilters).toBe(true);
    expect(result.current.activeFilterCount).toBe(1);
  });

  it('should filter by category', () => {
    const { result } = renderHook(() => useFilteredSubscriptions(mockSubscriptions));

    act(() => {
      result.current.filters.setSelectedCategories([SubscriptionCategory.STREAMING]);
    });

    expect(result.current.filteredAndSorted).toHaveLength(2);
    expect(
      result.current.filteredAndSorted.every(
        (sub) => sub.category === SubscriptionCategory.STREAMING
      )
    ).toBe(true);
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it('should filter by active status', () => {
    const { result } = renderHook(() => useFilteredSubscriptions(mockSubscriptions));

    act(() => {
      result.current.filters.setShowActiveOnly(false);
    });

    expect(result.current.filteredAndSorted).toHaveLength(3);
    expect(result.current.filteredAndSorted.some((sub) => !sub.isActive)).toBe(true);
  });

  it('should sort by name', () => {
    const { result } = renderHook(() => useFilteredSubscriptions(mockSubscriptions));

    act(() => {
      result.current.filters.setShowActiveOnly(false);
      result.current.filters.setSortBy('name');
      result.current.filters.setSortOrder('asc');
    });

    const names = result.current.filteredAndSorted.map((sub) => sub.name);
    expect(names).toEqual(['Adobe Creative Cloud', 'Netflix', 'Spotify']);
  });

  it('should sort by price', () => {
    const { result } = renderHook(() => useFilteredSubscriptions(mockSubscriptions));

    act(() => {
      result.current.filters.setShowActiveOnly(false);
      result.current.filters.setSortBy('price');
      result.current.filters.setSortOrder('asc');
    });

    const prices = result.current.filteredAndSorted.map((sub) => sub.price);
    expect(prices).toEqual([9.99, 15.99, 599.99]);
  });

  it('should clear all filters', () => {
    const { result } = renderHook(() => useFilteredSubscriptions(mockSubscriptions));

    act(() => {
      result.current.filters.setSearchQuery('Netflix');
      result.current.filters.setSelectedCategories([SubscriptionCategory.STREAMING]);
      result.current.filters.setShowActiveOnly(false);
    });

    expect(result.current.hasActiveFilters).toBe(true);

    act(() => {
      result.current.clearAllFilters();
    });

    expect(result.current.filteredAndSorted).toHaveLength(2);
    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.activeFilterCount).toBe(0);
    expect(result.current.filters.searchQuery).toBe('');
    expect(result.current.filters.selectedCategories).toEqual([]);
    expect(result.current.filters.showActiveOnly).toBe(true);
  });

  it('should handle empty subscriptions array', () => {
    const { result } = renderHook(() => useFilteredSubscriptions([]));

    expect(result.current.filteredAndSorted).toHaveLength(0);
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it('should handle null/undefined subscriptions', () => {
    const { result } = renderHook(() => useFilteredSubscriptions(null as any));

    expect(result.current.filteredAndSorted).toHaveLength(0);
  });
});
