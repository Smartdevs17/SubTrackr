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
  deleteDocument(id: string): void;
  readonly documentCount: number;
  search(query: SearchQuery): SearchResult;
  getTopQueries(limit?: number): { query: string; count: number }[];
  getAnalyticsEvents(): SearchAnalyticsEvent[];
  clearAnalytics(): void;
}
