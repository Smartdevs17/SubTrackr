import { ElasticsearchService } from '../ElasticsearchService';
import {
  Subscription,
  SubscriptionCategory,
  BillingCycle,
} from '../../../../src/types/subscription';

const makeSub = (overrides: Partial<Subscription> = {}): Subscription => ({
  id: 'sub-1',
  name: 'Netflix',
  description: 'Streaming service',
  category: SubscriptionCategory.STREAMING,
  price: 15.99,
  currency: 'USD',
  billingCycle: BillingCycle.MONTHLY,
  nextBillingDate: new Date('2026-05-01'),
  isActive: true,
  isCryptoEnabled: false,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

describe('ElasticsearchService (search module)', () => {
  let service: ElasticsearchService;

  beforeEach(() => {
    service = new ElasticsearchService();
    service.bulkIndex([
      makeSub({ id: '1', customerEmail: 'team@netflix.com', notes: 'priority account' }),
      makeSub({ id: '2', name: 'Spotify', planName: 'Spotify Family' }),
    ]);
  });

  it('indexes searchable CRM fields', () => {
    expect(service.search({ query: 'team@netflix.com' }).total).toBe(1);
    expect(service.search({ query: 'priority' }).total).toBe(1);
    expect(service.search({ query: 'Family' }).total).toBe(1);
  });

  it('exposes plan and status facets', () => {
    const { facets } = service.search({});
    expect(facets.plans.length).toBeGreaterThan(0);
    expect(facets.statuses.length).toBeGreaterThan(0);
  });
});
