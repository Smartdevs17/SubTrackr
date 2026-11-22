/**
 * Subscription query definitions (Issue #2074).
 *
 * Screens call these helpers instead of issuing `fetch()` inside effects. The
 * HTTP details live here, so changing the transport never touches a screen.
 */

import type { QueryClient } from './queryClient';
import type { QueryFetchOptions, QueryFetchContext, QueryResult } from './types';

export interface SubscriptionListItem {
  id: string;
  name: string;
  status: string;
  price: number;
  currency: string;
  nextBillingDate?: string;
}

export interface SubscriptionListFilters {
  status?: string;
  search?: string;
  limit?: number;
}

export interface SubscriptionCounts {
  total: number;
  active: number;
  canceled: number;
  pastDue: number;
}

export interface SubscriptionQueryApi {
  listSubscriptions(
    filters: SubscriptionListFilters,
    signal: AbortSignal,
  ): Promise<SubscriptionListItem[]>;
  getSubscription(id: string, signal: AbortSignal): Promise<SubscriptionListItem>;
  getCounts(signal: AbortSignal): Promise<SubscriptionCounts>;
}

export const SUBSCRIPTIONS_TAG = 'subscriptions';
export const SUBSCRIPTION_COUNTS_TAG = 'subscription-counts';

export const subscriptionKeys = {
  all: (): readonly ['subscriptions'] => ['subscriptions'],
  list: (filters: SubscriptionListFilters = {}): readonly [
    'subscriptions',
    'list',
    string | null,
    string | null,
    number | null,
  ] => [
    'subscriptions',
    'list',
    filters.status ?? null,
    filters.search ?? null,
    filters.limit ?? null,
  ],
  detail: (id: string): readonly ['subscriptions', 'detail', string] => [
    'subscriptions',
    'detail',
    id,
  ],
  counts: (): readonly ['subscriptions', 'counts'] => ['subscriptions', 'counts'],
};

export interface SubscriptionQueries {
  list(
    filters?: SubscriptionListFilters,
    overrides?: Partial<QueryFetchOptions<SubscriptionListItem[]>>,
  ): Promise<QueryResult<SubscriptionListItem[]>>;
  detail(
    id: string,
    overrides?: Partial<QueryFetchOptions<SubscriptionListItem>>,
  ): Promise<QueryResult<SubscriptionListItem>>;
  counts(
    overrides?: Partial<QueryFetchOptions<SubscriptionCounts>>,
  ): Promise<QueryResult<SubscriptionCounts>>;
  invalidateAll(): string[];
  invalidateDetail(id: string): string[];
}

/** Bind subscription keys/fetchers to a query client. */
export function createSubscriptionQueries(
  api: SubscriptionQueryApi,
  client: QueryClient,
): SubscriptionQueries {
  return {
    list(filters = {}, overrides = {}) {
      return client.fetch<SubscriptionListItem[]>({
        key: subscriptionKeys.list(filters),
        tags: [SUBSCRIPTIONS_TAG],
        ttlMs: 60_000,
        fetcher: ({ signal }: QueryFetchContext) => api.listSubscriptions(filters, signal),
        ...overrides,
      });
    },
    detail(id, overrides = {}) {
      return client.fetch<SubscriptionListItem>({
        key: subscriptionKeys.detail(id),
        tags: [SUBSCRIPTIONS_TAG],
        ttlMs: 60_000,
        fetcher: ({ signal }: QueryFetchContext) => api.getSubscription(id, signal),
        ...overrides,
      });
    },
    counts(overrides = {}) {
      return client.fetch<SubscriptionCounts>({
        key: subscriptionKeys.counts(),
        tags: [SUBSCRIPTIONS_TAG, SUBSCRIPTION_COUNTS_TAG],
        ttlMs: 30_000,
        fetcher: ({ signal }: QueryFetchContext) => api.getCounts(signal),
        ...overrides,
      });
    },
    invalidateAll() {
      return client.invalidate({ prefix: subscriptionKeys.all() });
    },
    invalidateDetail(id) {
      return client.invalidate({ key: subscriptionKeys.detail(id) });
    },
  };
}

export class QueryHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'QueryHttpError';
  }
}

export interface QueryHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type QueryFetchLike = (
  url: string,
  init?: { method?: string; signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<QueryHttpResponse>;

export interface HttpSubscriptionApiOptions {
  baseUrl: string;
  fetchImpl?: QueryFetchLike;
  headers?: Record<string, string>;
}

/** HTTP adapter that replaces per-screen `fetch()` calls. */
export function createHttpSubscriptionApi(
  options: HttpSubscriptionApiOptions,
): SubscriptionQueryApi {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const fetchImpl: QueryFetchLike =
    options.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit) as Promise<QueryHttpResponse>);

  async function request<T>(path: string, signal: AbortSignal): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'GET',
      signal,
      headers: { Accept: 'application/json', ...options.headers },
    });
    if (!response.ok) {
      throw new QueryHttpError(`HTTP ${response.status}`, response.status);
    }
    const body = await response.json();
    if (body && typeof body === 'object' && 'success' in body && body.success === false) {
      const message = 'error' in body && typeof body.error === 'string' ? body.error : 'Request failed';
      throw new QueryHttpError(message, response.status);
    }
    const data =
      body && typeof body === 'object' && 'data' in body ? (body as { data: T }).data : (body as T);
    return data;
  }

  return {
    listSubscriptions(filters, signal) {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.search) params.set('search', filters.search);
      if (filters.limit !== undefined) params.set('limit', String(filters.limit));
      const query = params.toString();
      return request<SubscriptionListItem[]>(
        `/api/subscriptions${query ? `?${query}` : ''}`,
        signal,
      );
    },
    getSubscription(id, signal) {
      return request<SubscriptionListItem>(`/api/subscriptions/${encodeURIComponent(id)}`, signal);
    },
    getCounts(signal) {
      return request<SubscriptionCounts>('/api/subscriptions/counts', signal);
    },
  };
}
