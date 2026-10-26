import {
  ElasticsearchService,
  elasticsearchService,
} from '../../../backend/services/search/ElasticsearchService';
import {
  Subscription,
  SubscriptionCategory,
  BillingCycle,
} from '../../../src/types/subscription';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('../../../src/store/subscriptionStore', () => ({
  useSubscriptionStore: {
    getState: () => ({
      subscriptions: [
        {
          id: '1',
          name: 'Netflix',
          planName: 'Netflix Premium',
          customerName: 'Jane Doe',
          customerEmail: 'jane@example.com',
          notes: 'auto-renew',
          category: SubscriptionCategory.STREAMING,
          price: 15.99,
          currency: 'USD',
          billingCycle: BillingCycle.MONTHLY,
          nextBillingDate: new Date('2026-05-01'),
          isActive: true,
          isCryptoEnabled: false,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ],
    }),
  },
}));

describe('searchService', () => {
  beforeEach(() => {
    elasticsearchService.bulkIndex([]);
  });

  it('delegates full-text search to ElasticsearchService', async () => {
    const { search_subscriptions } = require('../searchService');
    const result = search_subscriptions({ query: 'Jane' });
    expect(result.total).toBe(1);
    expect(result.hits[0].subscription.customerName).toBe('Jane Doe');
  });

  it('returns suggestions for partial queries', () => {
    const { get_search_suggestions } = require('../searchService');
    const suggestions = get_search_suggestions('net');
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it('persists saved searches', async () => {
    const { save_search, load_saved_searches } = require('../searchService');
    await save_search({
      id: 'saved-1',
      name: 'VIP',
      query: { query: 'Jane' },
      notifyOnNewMatches: true,
      createdAt: Date.now(),
    });
    const saved = await load_saved_searches();
    expect(saved.some((item: { id: string }) => item.id === 'saved-1')).toBe(true);
  });
});

describe('ElasticsearchService saved search notifications', () => {
  it('notifies when match count increases', () => {
    const service = new ElasticsearchService();
    const sub: Subscription = {
      id: '1',
      name: 'Acme',
      category: SubscriptionCategory.SOFTWARE,
      price: 10,
      currency: 'USD',
      billingCycle: BillingCycle.MONTHLY,
      nextBillingDate: new Date(),
      isActive: true,
      isCryptoEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    service.bulkIndex([]);
    service.registerSavedSearch({
      id: 'saved-2',
      name: 'Acme matches',
      query: { query: 'Acme' },
      notifyOnNewMatches: true,
      lastMatchCount: 0,
      createdAt: Date.now(),
    });

    expect(service.checkSavedSearchNotifications()).toEqual([]);
    service.indexDocument(sub);
    const notifications = service.checkSavedSearchNotifications();
    expect(notifications[0].newMatchCount).toBe(1);
  });
});
