import { toSubscriptionRowData, toSubscriptionRows } from '../mapRows';
import type { SubscriptionListItem } from '../../../queries';

const item: SubscriptionListItem = {
  id: 'sub-1',
  name: 'Netflix',
  status: 'active',
  price: 15.99,
  currency: 'USD',
  nextBillingDate: '2026-12-01',
};

describe('toSubscriptionRowData', () => {
  it('maps active and trialing subscriptions to active rows', () => {
    expect(toSubscriptionRowData(item)).toMatchObject({
      id: 'sub-1',
      name: 'Netflix',
      isActive: true,
      isPaused: false,
      price: 15.99,
    });
    expect(toSubscriptionRowData({ ...item, status: 'trialing' }).isActive).toBe(true);
  });

  it('maps paused and cancelled subscriptions to inactive rows', () => {
    expect(toSubscriptionRowData({ ...item, status: 'paused' })).toMatchObject({
      isActive: false,
      isPaused: true,
    });
    expect(toSubscriptionRowData({ ...item, status: 'canceled' })).toMatchObject({
      isActive: false,
      isPaused: false,
    });
  });

  it('preserves order and does not mutate the source items', () => {
    const items = [item, { ...item, id: 'sub-2', name: 'Spotify' }];
    const rows = toSubscriptionRows(items);

    expect(rows.map((row) => row.id)).toEqual(['sub-1', 'sub-2']);
    expect(items[0].status).toBe('active');
  });
});
