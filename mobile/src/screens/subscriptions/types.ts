/** Types for the virtualised subscriptions screen (Issue #2075). */

import type {
  QueryClient,
  SubscriptionListFilters,
  SubscriptionListItem,
  SubscriptionQueryApi,
} from '../../queries';
import type { FlashListTuningOverrides } from './flashListConfig';
import type { RowRenderMetrics } from './row';

export interface SubscriptionListMetrics {
  onView?: () => void;
  onVisibleRows?: (info: { count: number; indices: number[] }) => void;
  onRowRender?: (metrics: RowRenderMetrics) => void;
  onError?: (error: unknown) => void;
  onRefresh?: () => void;
}

export interface SubscriptionFlashListProps {
  subscriptions: readonly SubscriptionListItem[];
  loading?: boolean;
  error?: string | null;
  onPress: (item: SubscriptionListItem) => void;
  onToggleStatus?: (id: string) => void;
  onRefresh?: () => void;
  tuningOverrides?: FlashListTuningOverrides;
  metrics?: SubscriptionListMetrics;
  testID?: string;
}

export interface SubscriptionListScreenProps {
  /** Injected query API, so screens never call `fetch()` themselves. */
  api: SubscriptionQueryApi;
  client?: QueryClient;
  filters?: SubscriptionListFilters;
  onPress: (item: SubscriptionListItem) => void;
  onToggleStatus?: (id: string) => void;
  metrics?: SubscriptionListMetrics;
  testID?: string;
}
