/** Public API for the mobile query layer (Issue #2074). */

export { QueryCache } from './queryCache';
export type { QueryCacheOptions } from './queryCache';
export {
  isRetryableQueryError,
  queryErrorMessage,
  QueryClient,
} from './queryClient';
export type { InvalidateOptions, QueryClientOptions } from './queryClient';
export { defaultQueryClient } from './defaultQueryClient';
export { describeQueryKey, isQueryKeyPrefix, serializeQueryKey } from './queryKey';
export { createConsoleQueryTelemetry } from './telemetry';
export { useQuery } from './useQuery';
export type { UseQueryOptions, UseQueryResult } from './useQuery';
export {
  createHttpSubscriptionApi,
  createSubscriptionQueries,
  QueryHttpError,
  SUBSCRIPTION_COUNTS_TAG,
  SUBSCRIPTIONS_TAG,
  subscriptionKeys,
} from './subscriptions';
export type {
  HttpSubscriptionApiOptions,
  QueryFetchLike,
  QueryHttpResponse,
  SubscriptionCounts,
  SubscriptionListFilters,
  SubscriptionListItem,
  SubscriptionQueries,
  SubscriptionQueryApi,
} from './subscriptions';
export type {
  QueryEntry,
  QueryEvent,
  QueryEventType,
  QueryFetchContext,
  QueryFetcher,
  QueryFetchOptions,
  QueryKey,
  QueryLogger,
  QueryResult,
  QueryStatus,
  QueryTelemetry,
} from './types';
