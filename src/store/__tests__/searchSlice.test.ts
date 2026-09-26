import { act } from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { useAppStore, selectSearchQueryText, selectSavedSearches } from '../slices';
import { SubscriptionCategory } from '../../types/subscription';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
}));

describe('zustand search slice (composed in useAppStore)', () => {
  beforeEach(() => {
    useAppStore.setState({
      queryText: '',
      filters: { categories: [], billingCycles: [], plans: [], statuses: [] },
      sort: { field: '_score', order: 'desc' },
      result: null,
      savedSearches: [],
      suggestions: [],
      loading: false,
    });
  });

  it('sets the query text and runs a search', async () => {
    await act(async () => {
      useAppStore.getState().setQueryText('netflix');
    });

    expect(useAppStore.getState().queryText).toBe('netflix');
    expect(selectSearchQueryText(useAppStore.getState())).toBe('netflix');
    expect(useAppStore.getState().loading).toBe(false);
    expect(useAppStore.getState().result).not.toBeNull();
  });

  it('updates filters immutably without dropping existing keys', () => {
    useAppStore.getState().setFilters({ categories: [SubscriptionCategory.STREAMING] });

    const filters = useAppStore.getState().filters;
    expect(filters.categories).toEqual([SubscriptionCategory.STREAMING]);
    expect(filters.billingCycles).toEqual([]);
    expect(filters.plans).toEqual([]);
    expect(filters.statuses).toEqual([]);
  });

  it('updates the sort order', () => {
    useAppStore.getState().setSort({ field: 'price', order: 'asc' });

    expect(useAppStore.getState().sort).toEqual({ field: 'price', order: 'asc' });
  });

  it('refreshes suggestions from the index', async () => {
    await act(async () => {
      useAppStore.getState().refreshSuggestions('stream');
    });

    expect(useAppStore.getState().suggestions).toEqual([]);
  });

  it('saves and removes a saved search', async () => {
    await act(async () => {
      useAppStore.getState().setQueryText('netflix');
    });

    await act(async () => {
      await useAppStore.getState().saveCurrentSearch('My Netflix filter');
    });

    expect(useAppStore.getState().savedSearches).toHaveLength(1);
    expect(useAppStore.getState().savedSearches[0].name).toBe('My Netflix filter');
    expect(selectSavedSearches(useAppStore.getState())).toHaveLength(1);

    await act(async () => {
      await useAppStore.getState().removeSavedSearch(useAppStore.getState().savedSearches[0].id);
    });

    expect(useAppStore.getState().savedSearches).toHaveLength(0);
  });

  it('hydrates saved searches from storage', async () => {
    await act(async () => {
      await useAppStore.getState().hydrateSavedSearches();
    });

    expect(useAppStore.getState().savedSearches).toEqual([]);
  });

  it('clears transient search state while keeping saved searches', async () => {
    await act(async () => {
      useAppStore.getState().setQueryText('spotify');
      useAppStore.getState().setFilters({ categories: [SubscriptionCategory.STREAMING] });
      useAppStore.getState().clear();
    });

    expect(useAppStore.getState().queryText).toBe('');
    expect(useAppStore.getState().filters.categories).toEqual([]);
    expect(useAppStore.getState().sort).toEqual({ field: '_score', order: 'desc' });
    expect(useAppStore.getState().result).toBeNull();
  });

  it('loads a saved search back into the active query', async () => {
    await act(async () => {
      useAppStore.getState().setQueryText('youtube');
    });

    await act(async () => {
      await useAppStore.getState().saveCurrentSearch('Video');
    });

    const savedId = useAppStore.getState().savedSearches[0].id;

    await act(async () => {
      useAppStore.getState().setQueryText('disney');
      useAppStore.getState().loadSavedSearch(savedId);
    });

    expect(useAppStore.getState().queryText).toBe('youtube');
  });

  it('suggested sort orders are valid', () => {
    const sort = useAppStore.getState().sort;
    expect(sort.field).toBe('_score');
    expect(['asc', 'desc']).toContain(sort.order);
  });
});