/**
 * Stable key selectors and prop comparators for subscription rows (Issue #2088).
 *
 * A FlatList re-creates item objects when filters or sort order change. Keying
 * by `id` (rather than by array index) lets React reuse the native row view and
 * avoids re-rendering every visible cell. When a subscription has no id yet
 * (optimistic inserts), a deterministic fallback keeps the key stable across
 * renders until the server assigns one.
 */

import type { RowKeySelector, SubscriptionRowData, SubscriptionRowProps } from './types';

const DEFAULT_NAMESPACE = 'subscription';
const FALLBACK_NAMESPACE = 'subscription-row';

function dateValue(value?: string | Date): number {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function fallbackKey(
  subscription: SubscriptionRowData | undefined,
  prefix: string,
  index: number
): string {
  const source = subscription ?? ({} as SubscriptionRowData);
  return [
    prefix,
    source.name ?? '',
    dateValue(source.nextBillingDate),
    dateValue(source.updatedAt),
    index,
  ].join(':');
}

/** Key for a single subscription. Prefixed to avoid collisions with other lists. */
export function subscriptionRowKey(subscription: SubscriptionRowData, index = 0): string {
  if (subscription && subscription.id) {
    return `${DEFAULT_NAMESPACE}:${subscription.id}`;
  }
  return fallbackKey(subscription, FALLBACK_NAMESPACE, index);
}

/** Create a selector with a custom namespace (e.g. one per independent list). */
export function createStableRowKeySelector(namespace = DEFAULT_NAMESPACE): RowKeySelector {
  const prefix = namespace || DEFAULT_NAMESPACE;
  return (subscription, index = 0) => {
    if (subscription && subscription.id) return `${prefix}:${subscription.id}`;
    return fallbackKey(subscription, prefix, index);
  };
}

/** True when two item objects describe the same row content. */
export function isSameSubscriptionRow(
  prev: SubscriptionRowData | undefined,
  next: SubscriptionRowData | undefined
): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;

  return (
    prev.id === next.id &&
    prev.name === next.name &&
    prev.description === next.description &&
    prev.category === next.category &&
    prev.price === next.price &&
    prev.currency === next.currency &&
    prev.isActive === next.isActive &&
    prev.isPaused === next.isPaused &&
    dateValue(prev.nextBillingDate) === dateValue(next.nextBillingDate) &&
    dateValue(prev.updatedAt) === dateValue(next.updatedAt)
  );
}

/**
 * Comparator passed to `React.memo`. Callbacks are compared by reference, so
 * list parents should wrap them in `useCallback` to get the full benefit.
 */
export function areRowPropsEqual(prev: SubscriptionRowProps, next: SubscriptionRowProps): boolean {
  return (
    isSameSubscriptionRow(prev.subscription, next.subscription) &&
    prev.onPress === next.onPress &&
    prev.onToggleStatus === next.onToggleStatus &&
    prev.index === next.index &&
    prev.testID === next.testID &&
    prev.onRender === next.onRender
  );
}

/** FlatList-compatible `keyExtractor` backed by the stable selector. */
export function createKeyExtractor(selector: RowKeySelector = subscriptionRowKey) {
  return (item: SubscriptionRowData, index: number): string => selector(item, index);
}
