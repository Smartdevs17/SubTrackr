/** Map query-layer subscription records onto the memoised row's smaller shape. */

import type { SubscriptionRowData } from './row';
import type { SubscriptionListItem } from '../../queries';

export function toSubscriptionRowData(item: SubscriptionListItem): SubscriptionRowData {
  return {
    id: item.id,
    name: item.name,
    category: item.status,
    price: item.price,
    currency: item.currency,
    isActive: item.status === 'active' || item.status === 'trialing',
    isPaused: item.status === 'paused',
    nextBillingDate: item.nextBillingDate,
  };
}

export function toSubscriptionRows(items: readonly SubscriptionListItem[]): SubscriptionRowData[] {
  return items.map(toSubscriptionRowData);
}
