/**
 * Tests for Issue #916/#945 — AdvancedSearchService routing, suggestions,
 * saved searches, analytics and health, using a real in-memory peer and a
 * fake connection pool.
 */

import { Subscription } from '../../../src/types/subscription';
import { ElasticsearchService, SearchQuery, SavedSearchDefinition } from '../../services/search/ElasticsearchService';
import {
  AdvancedSearchService,
  AdvancedSearchSuggestion,
  SearchClusterHealth,
} from '../searchService';

// ── Helpers ────────────────────────────────────────────────────────────────

const makeSubscription = (overrides: Partial<Subscription> = {}): Subscription => ({
  id: `sub_${Math.random().toString(36).slice(2)}`,
  name: 'Test Service',
  category: 'productivity' as Subscription['category'],
  price: 9.99,
  currency: 'USD',
  billingCycle: 'monthly' as Subscription['billingCycle'],
  nextBillingDate: new Date(),
  isActive: true,
  isCryptoEnabled: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeFakePool = () => ({
  withConnection: <T>(task: () => Promise<T> | T) => Promise.resolve(task()),
  getMetrics: () => ({
    totalConnections: 4,
    activeConnections: 2,
    idleConnections: 2,
    peakUtilisation: 0.5,
    acquireTimeouts: 0,
    leaksDetected: 0,
  }),
  getTuningRecommendations: () => ['raise idleTimeoutMs'],
});

// The AdvancedSearchService constructor accepts an injected `pool`, so the
// real in-memory ElasticsearchService is used as the peer.
const makeService = () => {
  const peer = new ElasticsearchService();
  const service = new AdvancedSearchService({
    peer,
    pool: makeFakePool() as never,
  });
  return { service, peer };
};

// ── AdvancedSearchService ──────────────────────────────────────────────────

describe('AdvancedSearchService', () => {
  it('indexes documents and reports the document count', async () => {
    const { service } = makeService();
    await service.indexDocument(makeSubscription({ name: 'Netflix' }));

    expect(service.documentCount).toBe(1);
  });

  it('bulk indexes a list of subscriptions', async () => {
    const { service } = makeService();
    await service.bulkIndex([
      makeSubscription({ name: 'Spotify' }),
      makeSubscription({ name: 'Disney+' }),
    ]);

    expect(service.documentCount).toBe(2);
  });

  it('deletes a document by id', async () => {
    const { service } = makeService();
    const sub = makeSubscription({ name: 'Netflix' });
    await service.indexDocument(sub);
    await service.deleteDocument(sub.id);

    expect(service.documentCount).toBe(0);
  });

  it('searches by query text and returns hits', async () => {
    const { service } = makeService();
    await service.bulkIndex([
      makeSubscription({ name: 'Netflix' }),
      makeSubscription({ name: 'Spotify' }),
    ]);

    const result = await service.search({ query: 'netflix', size: 10 });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].subscription.name).toBe('Netflix');
  });

  it('exposes getSuggestions delegating to suggest', async () => {
    const { service } = makeService();
    await service.indexDocument(makeSubscription({ name: 'Netflix', category: 'streaming' }));

    const suggestions: AdvancedSearchSuggestion[] = await service.getSuggestions('str');
    expect(Array.isArray(suggestions)).toBe(true);
    expect(suggestions.some((s) => s.source === 'category' && s.value === 'streaming')).toBe(true);
  });

  it('registers, lists and removes saved searches', async () => {
    const { service } = makeService();
    const savedSearch: SavedSearchDefinition = {
      id: 'saved-1',
      name: 'Streaming picks',
      query: { query: 'netflix' },
    };

    await service.registerSavedSearch(savedSearch);
    await service.loadSavedSearches([savedSearch]);

    const saved = await service.listSavedSearches();
    expect(saved.some((s) => s.id === 'saved-1')).toBe(true);

    await service.removeSavedSearch('saved-1');
    const after = await service.listSavedSearches();
    expect(after.some((s) => s.id === 'saved-1')).toBe(false);
  });

  it('tracks top queries and analytics events', async () => {
    const { service } = makeService();
    await service.bulkIndex([makeSubscription({ name: 'Netflix' })]);

    const query: SearchQuery = { query: 'netflix' };
    await service.search(query);
    await service.search(query);

    const top = service.getTopQueries(5);
    expect(top.length).toBeGreaterThanOrEqual(1);
    expect(top[0].query).toBe('netflix');
    expect(top[0].count).toBeGreaterThanOrEqual(2);

    const events = service.getAnalyticsEvents();
    expect(events.length).toBeGreaterThanOrEqual(2);

    service.clearAnalytics();
    expect(service.getAnalyticsEvents()).toHaveLength(0);
  });

  it('reports cluster health from pool metrics', async () => {
    const { service } = makeService();
    await service.bulkIndex([makeSubscription({ name: 'Netflix' })]);

    const health: SearchClusterHealth = await service.health();
    expect(health.status).toBe('green');
    expect(health.documents).toBe(1);
    expect(health.pool.totalConnections).toBe(4);
    expect(health.pool.acquireTimeouts).toBe(0);
    expect(health.tuning).toContain('raise idleTimeoutMs');
    expect(health.updatedAt).toBeDefined();
  });
});