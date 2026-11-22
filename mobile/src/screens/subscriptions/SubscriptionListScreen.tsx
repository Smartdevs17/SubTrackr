/**
 * Subscriptions screen (Issue #2075).
 *
 * Data comes from the dedicated query layer; this component only maps query
 * state onto the virtualised FlashList and emits view telemetry.
 */

import React, { useCallback, useEffect, useMemo } from 'react';

import {
  queryErrorMessage,
  subscriptionKeys,
  SUBSCRIPTIONS_TAG,
  useQuery,
} from '../../queries';
import type { SubscriptionListItem } from '../../queries';
import { SubscriptionFlashList } from './SubscriptionFlashList';
import type { SubscriptionListScreenProps } from './types';

export const SubscriptionListScreen: React.FC<SubscriptionListScreenProps> = ({
  api,
  client,
  filters = {},
  onPress,
  onToggleStatus,
  metrics,
  testID,
}) => {
  const statusFilter = filters.status ?? null;
  const searchFilter = filters.search ?? null;
  const limitFilter = filters.limit ?? null;

  const key = useMemo(
    () => subscriptionKeys.list({ status: statusFilter ?? undefined, search: searchFilter ?? undefined, limit: limitFilter ?? undefined }),
    [statusFilter, searchFilter, limitFilter],
  );
  const fetcher = useCallback(
    ({ signal }: { signal: AbortSignal }) => api.listSubscriptions(filters, signal),
    // Filter values, not the object identity, decide when to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, statusFilter, searchFilter, limitFilter],
  );

  const { data, status: queryStatus, isFetching, error, refetch } = useQuery<
    SubscriptionListItem[]
  >({
    client,
    key,
    fetcher,
    tags: [SUBSCRIPTIONS_TAG],
    ttlMs: 60_000,
  });

  useEffect(() => {
    metrics?.onView?.();
  }, [metrics]);

  useEffect(() => {
    if (queryStatus === 'error') metrics?.onError?.(error);
  }, [queryStatus, error, metrics]);

  const handleRefresh = useCallback(() => {
    metrics?.onRefresh?.();
    void refetch();
  }, [metrics, refetch]);

  return (
    <SubscriptionFlashList
      testID={testID}
      subscriptions={data ?? []}
      loading={isFetching || queryStatus === 'loading'}
      error={queryStatus === 'error' ? queryErrorMessage(error) : null}
      onPress={onPress}
      onToggleStatus={onToggleStatus}
      onRefresh={handleRefresh}
      metrics={metrics}
    />
  );
};
