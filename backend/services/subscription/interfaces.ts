import { Subscription } from '../../../src/types/subscription';
import {
  SubscriptionEvent,
  SubscriptionEventQuery,
  SubscriptionEventPage,
} from './subscriptionEventStore';
import {
  SearchQuery,
  SearchResult,
  SearchAnalyticsEvent,
  SavedSearchDefinition,
  SavedSearchMatchNotification,
} from './ElasticsearchService';

export interface ISubscriptionEventStore {
  append<TPayload extends Record<string, unknown> = Record<string, unknown>>(
    event: Omit<SubscriptionEvent<TPayload>, 'id' | 'sequence' | 'occurredAt' | 'schemaVersion'> &
      Partial<Pick<SubscriptionEvent, 'occurredAt' | 'schemaVersion'>>
  ): SubscriptionEvent<TPayload>;

  query(query?: SubscriptionEventQuery): SubscriptionEventPage;

  reconstruct(subscriptionId: string): Record<string, unknown>;

  replay(subscriptionId: string, handler: (event: SubscriptionEvent) => void): void;

  archiveBefore(timestamp: number): number;
}

export interface IElasticsearchService {
  indexDocument(subscription: Subscription): void;
  bulkIndex(subscriptions: Subscription[]): void;
  reindexForSchemaChange(subscriptions: Subscription[]): void;
  deleteDocument(id: string): void;
  readonly documentCount: number;
  getIndexLagMs(): number;
  search(query: SearchQuery): SearchResult;
  registerSavedSearch(savedSearch: SavedSearchDefinition): void;
  removeSavedSearch(id: string): void;
  listSavedSearches(): SavedSearchDefinition[];
  loadSavedSearches(savedSearches: SavedSearchDefinition[]): void;
  checkSavedSearchNotifications(): SavedSearchMatchNotification[];
  getTopQueries(limit?: number): { query: string; count: number }[];
  getAnalyticsEvents(): SearchAnalyticsEvent[];
  clearAnalytics(): void;
}

export type { SavedSearchDefinition, SavedSearchMatchNotification };
