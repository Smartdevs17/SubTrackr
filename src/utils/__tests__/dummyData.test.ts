import { getUpcomingSubscriptions, _clearUpcomingCache } from '../dummyData';
import { Subscription, SubscriptionCategory, BillingCycle } from '../../types/subscription';

/** Helper to build a minimal Subscription for testing. */
const makeSub = (
  overrides: Partial<Subscription> & { id: string; nextBillingDate: Date }
): Subscription => ({
  name: `Sub ${overrides.id}`,
  description: '',
  category: SubscriptionCategory.OTHER,
  price: 9.99,
  currency: 'USD',
  billingCycle: BillingCycle.MONTHLY,
  isActive: true,
  isCryptoEnabled: false,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ...overrides,
});

const DAY_MS = 24 * 60 * 60 * 1000;

describe('getUpcomingSubscriptions', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    _clearUpcomingCache();
  });

  const NOW = new Date('2024-06-15T12:00:00Z').getTime();

  it('returns active subscriptions within the next 7 days', () => {
    const subs: Subscription[] = [
      makeSub({ id: '1', nextBillingDate: new Date(NOW + 1 * DAY_MS) }),
      makeSub({ id: '2', nextBillingDate: new Date(NOW + 6 * DAY_MS) }),
    ];

    const result = getUpcomingSubscriptions(subs);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('1');
    expect(result[1].id).toBe('2');
  });

  it('excludes inactive subscriptions', () => {
    const subs: Subscription[] = [
      makeSub({ id: '1', nextBillingDate: new Date(NOW + 1 * DAY_MS), isActive: false }),
      makeSub({ id: '2', nextBillingDate: new Date(NOW + 2 * DAY_MS) }),
    ];

    const result = getUpcomingSubscriptions(subs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('excludes subscriptions beyond 7 days', () => {
    const subs: Subscription[] = [
      makeSub({ id: '1', nextBillingDate: new Date(NOW + 8 * DAY_MS) }),
      makeSub({ id: '2', nextBillingDate: new Date(NOW + 15 * DAY_MS) }),
    ];

    const result = getUpcomingSubscriptions(subs);
    expect(result).toHaveLength(0);
  });

  it('excludes subscriptions in the past', () => {
    const subs: Subscription[] = [
      makeSub({ id: '1', nextBillingDate: new Date(NOW - 1 * DAY_MS) }),
    ];

    const result = getUpcomingSubscriptions(subs);
    expect(result).toHaveLength(0);
  });

  it('returns results sorted by billing date ascending', () => {
    const subs: Subscription[] = [
      makeSub({ id: 'c', nextBillingDate: new Date(NOW + 5 * DAY_MS) }),
      makeSub({ id: 'a', nextBillingDate: new Date(NOW + 1 * DAY_MS) }),
      makeSub({ id: 'b', nextBillingDate: new Date(NOW + 3 * DAY_MS) }),
    ];

    const result = getUpcomingSubscriptions(subs);
    expect(result.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('includes subscriptions due exactly today (now)', () => {
    const subs: Subscription[] = [makeSub({ id: '1', nextBillingDate: new Date(NOW) })];

    const result = getUpcomingSubscriptions(subs);
    expect(result).toHaveLength(1);
  });

  it('includes subscriptions due exactly at the 7-day boundary', () => {
    const subs: Subscription[] = [
      makeSub({ id: '1', nextBillingDate: new Date(NOW + 7 * DAY_MS) }),
    ];

    const result = getUpcomingSubscriptions(subs);
    expect(result).toHaveLength(1);
  });

  it('handles empty array', () => {
    expect(getUpcomingSubscriptions([])).toEqual([]);
  });

  it('handles null / undefined gracefully', () => {
    expect(getUpcomingSubscriptions(null as unknown as Subscription[])).toEqual([]);
    expect(getUpcomingSubscriptions(undefined as unknown as Subscription[])).toEqual([]);
  });

  it('returns cached result for the same input reference', () => {
    const subs: Subscription[] = [
      makeSub({ id: '1', nextBillingDate: new Date(NOW + 1 * DAY_MS) }),
    ];

    const first = getUpcomingSubscriptions(subs);
    const second = getUpcomingSubscriptions(subs);
    expect(first).toBe(second); // Same reference (===) means cache hit
  });

  it('invalidates cache when input reference changes', () => {
    const subs1: Subscription[] = [
      makeSub({ id: '1', nextBillingDate: new Date(NOW + 1 * DAY_MS) }),
    ];
    const subs2: Subscription[] = [
      makeSub({ id: '2', nextBillingDate: new Date(NOW + 2 * DAY_MS) }),
    ];

    const first = getUpcomingSubscriptions(subs1);
    const second = getUpcomingSubscriptions(subs2);
    expect(first).not.toBe(second);
    expect(second[0].id).toBe('2');
  });
});
