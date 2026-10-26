import { ElasticsearchService } from '../../search/ElasticsearchService';
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

const SUBS: Subscription[] = [
  makeSub({ id: '1', name: 'Netflix', category: SubscriptionCategory.STREAMING, price: 15.99 }),
  makeSub({
    id: '2',
    name: 'Spotify',
    description: 'Music streaming',
    category: SubscriptionCategory.STREAMING,
    price: 9.99,
  }),
  makeSub({
    id: '3',
    name: 'GitHub Pro',
    description: 'Developer tools',
    category: SubscriptionCategory.SOFTWARE,
    price: 4.0,
  }),
  makeSub({
    id: '4',
    name: 'AWS',
    description: 'Cloud infrastructure',
    category: SubscriptionCategory.SOFTWARE,
    price: 120.0,
    isCryptoEnabled: true,
  }),
  makeSub({
    id: '5',
    name: 'Duolingo Plus',
    description: 'Language learning',
    category: SubscriptionCategory.EDUCATION,
    price: 6.99,
    billingCycle: BillingCycle.YEARLY,
    isActive: false,
  }),
];

describe('ElasticsearchService', () => {
  let service: ElasticsearchService;

  beforeEach(() => {
    service = new ElasticsearchService();
    service.bulkIndex(SUBS);
  });

  // Indexing pipeline
  it('indexes all documents', () => {
    expect(service.documentCount).toBe(5);
  });

  it('replaces index on bulkIndex', () => {
    service.bulkIndex([SUBS[0]]);
    expect(service.documentCount).toBe(1);
  });

  it('deletes a document', () => {
    service.deleteDocument('1');
    expect(service.documentCount).toBe(4);
  });

  // Full-text search
  it('returns all docs when no query', () => {
    expect(service.search({}).total).toBe(5);
  });

  it('finds exact name match', () => {
    const { hits } = service.search({ query: 'Netflix' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].subscription.id).toBe('1');
  });

  it('finds match in description', () => {
    const { hits } = service.search({ query: 'infrastructure' });
    expect(hits.some((h) => h.subscription.id === '4')).toBe(true);
  });

  it('scores exact matches higher than fuzzy', () => {
    const { hits } = service.search({ query: 'streaming' });
    const scores = hits.map((h) => h.score);
    expect(scores[0]).toBeGreaterThanOrEqual(scores[scores.length - 1]);
  });

  // Fuzzy matching
  it('fuzzy matches a typo (Netflx -> Netflix)', () => {
    const { hits } = service.search({ query: 'Netflx' });
    expect(hits.some((h) => h.subscription.id === '1')).toBe(true);
  });

  it('fuzzy matches partial term (Spotif -> Spotify)', () => {
    const { hits } = service.search({ query: 'Spotif' });
    expect(hits.some((h) => h.subscription.id === '2')).toBe(true);
  });

  // Faceted navigation
  it('filters by category', () => {
    const { hits } = service.search({ filters: { categories: [SubscriptionCategory.STREAMING] } });
    expect(hits.every((h) => h.subscription.category === SubscriptionCategory.STREAMING)).toBe(
      true
    );
    expect(hits.length).toBe(2);
  });

  it('filters by billing cycle', () => {
    const { hits } = service.search({ filters: { billingCycles: [BillingCycle.YEARLY] } });
    expect(hits.every((h) => h.subscription.billingCycle === BillingCycle.YEARLY)).toBe(true);
  });

  it('filters by price range', () => {
    const { hits } = service.search({ filters: { priceRange: { min: 5, max: 20 } } });
    expect(hits.every((h) => h.subscription.price >= 5 && h.subscription.price <= 20)).toBe(true);
  });

  it('filters active only', () => {
    const { hits } = service.search({ filters: { isActive: true } });
    expect(hits.every((h) => h.subscription.isActive)).toBe(true);
  });

  it('filters crypto enabled', () => {
    const { hits } = service.search({ filters: { isCryptoEnabled: true } });
    expect(hits.every((h) => h.subscription.isCryptoEnabled)).toBe(true);
    expect(hits.length).toBe(1);
  });

  // Facet aggregations
  it('returns category facets with counts', () => {
    const { facets } = service.search({});
    const streaming = facets.categories.find((c) => c.key === SubscriptionCategory.STREAMING);
    expect(streaming?.count).toBe(2);
  });

  it('returns price stats', () => {
    const { facets } = service.search({});
    expect(facets.priceStats.min).toBe(4.0);
    expect(facets.priceStats.max).toBe(120.0);
    expect(facets.priceStats.avg).toBeGreaterThan(0);
  });

  it('returns active and crypto counts', () => {
    const { facets } = service.search({});
    expect(facets.activeCount).toBe(4);
    expect(facets.cryptoCount).toBe(1);
  });

  // Sorting
  it('sorts by price ascending', () => {
    const { hits } = service.search({ sort: { field: 'price', order: 'asc' } });
    const prices = hits.map((h) => h.subscription.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('sorts by name descending', () => {
    const { hits } = service.search({ sort: { field: 'name', order: 'desc' } });
    const names = hits.map((h) => h.subscription.name);
    expect(names).toEqual([...names].sort((a, b) => b.localeCompare(a)));
  });

  // Highlights
  it('returns highlights for matched fields', () => {
    const { hits } = service.search({ query: 'Netflix' });
    expect(hits[0].highlights['name']).toBeDefined();
  });

  // Pagination
  it('paginates results', () => {
    const page1 = service.search({ from: 0, size: 2 });
    const page2 = service.search({ from: 2, size: 2 });
    expect(page1.hits.length).toBe(2);
    expect(page2.hits.length).toBe(2);
    expect(page1.hits[0].subscription.id).not.toBe(page2.hits[0].subscription.id);
  });

  // Analytics
  it('records search analytics', () => {
    service.search({ query: 'netflix' });
    service.search({ query: 'spotify' });
    service.search({ query: 'netflix' });
    expect(service.getAnalyticsEvents().length).toBe(3);
  });

  it('returns top queries sorted by frequency', () => {
    service.search({ query: 'netflix' });
    service.search({ query: 'netflix' });
    service.search({ query: 'spotify' });
    const top = service.getTopQueries(2);
    expect(top[0].query).toBe('netflix');
    expect(top[0].count).toBe(2);
  });

  it('clears analytics', () => {
    service.search({ query: 'netflix' });
    service.clearAnalytics();
    expect(service.getAnalyticsEvents().length).toBe(0);
  });

  it('does not record analytics for empty query', () => {
    service.search({});
    expect(service.getAnalyticsEvents().length).toBe(0);
  });

  it('reports took time in ms', () => {
    const { took } = service.search({ query: 'netflix' });
    expect(typeof took).toBe('number');
    expect(took).toBeGreaterThanOrEqual(0);
  });

  it('searches customer name, email, plan name, and notes', () => {
    service.bulkIndex([
      makeSub({
        id: 'crm-1',
        customerName: 'Jane Doe',
        customerEmail: 'jane@acme.com',
        planName: 'Enterprise Plus',
        notes: 'VIP renewal candidate',
        name: 'Acme Subscription',
      }),
    ]);

    expect(service.search({ query: 'Jane' }).total).toBe(1);
    expect(service.search({ query: 'jane@acme.com' }).total).toBe(1);
    expect(service.search({ query: 'Enterprise' }).total).toBe(1);
    expect(service.search({ query: 'renewal' }).total).toBe(1);
  });

  it('filters by date range', () => {
    const { hits } = service.search({
      filters: {
        dateRange: {
          from: new Date('2026-04-01'),
          to: new Date('2026-05-15'),
          field: 'nextBillingDate',
        },
      },
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(
      hits.every(
        (h) =>
          new Date(h.subscription.nextBillingDate) >= new Date('2026-04-01') &&
          new Date(h.subscription.nextBillingDate) <= new Date('2026-05-15')
      )
    ).toBe(true);
  });

  it('wraps matched terms in highlight tags', () => {
    const { hits } = service.search({ query: 'Netflix' });
    const highlighted = Object.values(hits[0].highlights);
    expect(highlighted.some((value) => value.includes('<em>'))).toBe(true);
  });

  it('supports saved search notifications for new matches', () => {
    service.registerSavedSearch({
      id: 'saved-1',
      name: 'Streaming',
      query: { filters: { categories: [SubscriptionCategory.STREAMING] } },
      notifyOnNewMatches: true,
      lastMatchCount: 0,
      createdAt: Date.now(),
    });

    const first = service.checkSavedSearchNotifications();
    expect(first[0]?.newMatchCount).toBe(2);

    const second = service.checkSavedSearchNotifications();
    expect(second.length).toBe(0);
  });

  it('reindexes on schema change', () => {
    service.reindexForSchemaChange(SUBS.slice(0, 2));
    expect(service.documentCount).toBe(2);
  });
});
