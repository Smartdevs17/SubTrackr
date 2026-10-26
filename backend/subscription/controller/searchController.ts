import { randomUUID } from 'crypto';

import { BillingCycle, SubscriptionCategory } from '../../../src/types/subscription';
import { fail, ok, type ApiResponse } from '../../services/shared/apiResponse';
import {
  elasticsearchService,
  type SavedSearchDefinition,
  type SearchQuery,
  type SearchResult,
} from '../../services/search/ElasticsearchService';

export type SubscriptionStatusParam = 'active' | 'paused' | 'cancelled' | 'inactive';

export interface SubscriptionSearchQueryParams {
  q?: string;
  status?: SubscriptionStatusParam;
  category?: string;
  billingCycle?: string;
  minPrice?: number;
  maxPrice?: number;
  dateFrom?: string;
  dateTo?: string;
  dateField?: 'nextBillingDate' | 'createdAt';
  isCryptoEnabled?: 'true' | 'false';
  sort?: 'name' | 'price' | 'nextBillingDate' | 'category' | '_score';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface SubscriptionSearchProvider {
  search(query: SearchQuery): SearchResult;
  listSavedSearches(): SavedSearchDefinition[];
  registerSavedSearch(savedSearch: SavedSearchDefinition): void;
  removeSavedSearch(id: string): void;
}

export const storeSubscriptionSearchProvider: SubscriptionSearchProvider = {
  search: (query) => elasticsearchService.search(query),
  listSavedSearches: () => elasticsearchService.listSavedSearches(),
  registerSavedSearch: (savedSearch) => elasticsearchService.registerSavedSearch(savedSearch),
  removeSavedSearch: (id) => elasticsearchService.removeSavedSearch(id),
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const INACTIVE_STATUSES: ReadonlySet<string> = new Set(['paused', 'cancelled', 'inactive']);

function normalizeStatus(status: SubscriptionStatusParam): 'active' | 'inactive' {
  return INACTIVE_STATUSES.has(status) ? 'inactive' : 'active';
}

function toNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function buildSearchQuery(params: SubscriptionSearchQueryParams): SearchQuery {
  const page = Math.max(1, Math.floor(toNumber(params.page) ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(toNumber(params.pageSize) ?? DEFAULT_PAGE_SIZE)));
  const from = (page - 1) * pageSize;

  const minPrice = toNumber(params.minPrice);
  const maxPrice = toNumber(params.maxPrice);
  const dateFrom = params.dateFrom && !Number.isNaN(Date.parse(params.dateFrom)) ? params.dateFrom : undefined;
  const dateTo = params.dateTo && !Number.isNaN(Date.parse(params.dateTo)) ? params.dateTo : undefined;

  const filters: SearchQuery['filters'] = {};
  if (params.status) filters.statuses = [normalizeStatus(params.status)];
  if (params.category) filters.categories = params.category.split(',') as SubscriptionCategory[];
  if (params.billingCycle) filters.billingCycles = params.billingCycle.split(',') as BillingCycle[];
  if (minPrice !== undefined || maxPrice !== undefined) {
    filters.priceRange = {
      min: minPrice ?? 0,
      max: maxPrice ?? Number.MAX_SAFE_INTEGER,
    };
  }
  if (dateFrom || dateTo) {
    filters.dateRange = {
      from: new Date(dateFrom ?? '1970-01-01'),
      to: new Date(dateTo ?? '2100-01-01'),
      field: params.dateField,
    };
  }
  if (params.isCryptoEnabled !== undefined) {
    filters.isCryptoEnabled = params.isCryptoEnabled === 'true';
  }

  return {
    query: params.q,
    filters,
    sort: params.sort && params.order ? { field: params.sort, order: params.order } : undefined,
    from,
    size: pageSize,
  };
}

export function searchSubscriptions(
  params: SubscriptionSearchQueryParams,
  provider: SubscriptionSearchProvider = storeSubscriptionSearchProvider,
  requestId?: string
): ApiResponse<SearchResult> {
  try {
    const query = buildSearchQuery(params);
    const result = provider.search(query);
    const total = result.total;
    const from = query.from ?? 0;
    const size = query.size ?? DEFAULT_PAGE_SIZE;
    return ok(result, requestId, {
      total,
      hasMore: from + size < total,
    });
  } catch (error) {
    return fail('INTERNAL_SERVER_ERROR', error instanceof Error ? error.message : 'Search failed.', requestId);
  }
}

export function listSavedSearches(
  provider: SubscriptionSearchProvider = storeSubscriptionSearchProvider,
  requestId?: string
): ApiResponse<SavedSearchDefinition[]> {
  return ok(provider.listSavedSearches(), requestId);
}

export function createSavedSearch(
  input: Partial<SavedSearchDefinition>,
  provider: SubscriptionSearchProvider = storeSubscriptionSearchProvider,
  requestId?: string
): ApiResponse<SavedSearchDefinition> {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const query = input.query;
  if (!name || !query || typeof query !== 'object') {
    return fail('VALIDATION_ERROR', 'A saved search requires a name and a query.', requestId);
  }

  const savedSearch: SavedSearchDefinition = {
    id: input.id ?? randomUUID(),
    name,
    query,
    notifyOnNewMatches: Boolean(input.notifyOnNewMatches),
    createdAt: input.createdAt ?? Date.now(),
  };
  provider.registerSavedSearch(savedSearch);
  return ok(savedSearch, requestId);
}

export function deleteSavedSearch(
  id: string,
  provider: SubscriptionSearchProvider = storeSubscriptionSearchProvider,
  requestId?: string
): ApiResponse<{ id: string; deleted: boolean }> {
  const exists = provider.listSavedSearches().some((savedSearch) => savedSearch.id === id);
  if (!exists) {
    return fail('NOT_FOUND', `Saved search "${id}" not found`, requestId);
  }
  provider.removeSavedSearch(id);
  return ok({ id, deleted: true }, requestId);
}