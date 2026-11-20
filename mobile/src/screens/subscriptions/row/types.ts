/**
 * Types for memoized subscription list rows (Issue #2088).
 *
 * The row only depends on the small subset of subscription fields it renders,
 * which keeps the custom `React.memo` comparator cheap and stable.
 */

/** Minimal subscription shape required to render a row. */
export interface SubscriptionRowData {
  id: string;
  name: string;
  description?: string;
  category?: string;
  price: number;
  currency: string;
  isActive: boolean;
  isPaused?: boolean;
  nextBillingDate?: string | Date;
  updatedAt?: string | Date;
}

/** Render-time counters emitted through the optional metrics hook. */
export interface RowRenderMetrics {
  key: string;
  renderedAt: number;
}

export interface SubscriptionRowProps {
  subscription: SubscriptionRowData;
  onPress: (subscription: SubscriptionRowData) => void;
  onToggleStatus?: (id: string) => void;
  index?: number;
  testID?: string;
  onRender?: (metrics: RowRenderMetrics) => void;
}

/** Pure function returning a key that survives list re-ordering and filtering. */
export type RowKeySelector = (subscription: SubscriptionRowData, index?: number) => string;
