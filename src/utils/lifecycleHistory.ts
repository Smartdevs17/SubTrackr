/**
 * Lifecycle history helpers.
 *
 * Pure functions for building, sorting, labelling and exporting the
 * timestamped state transitions recorded in the subscription store.
 */

import type {
  SubscriptionLifecycleEvent,
  SubscriptionLifecycleEventType,
} from '../types/subscription';

const EVENT_LABELS: Record<SubscriptionLifecycleEventType, string> = {
  created: 'Created',
  updated: 'Updated',
  price_changed: 'Price changed',
  plan_changed: 'Plan changed',
  activated: 'Activated',
  paused: 'Paused',
  resumed: 'Resumed',
  cancelled: 'Cancelled',
};

let counter = 0;

function generateEventId(): string {
  counter = (counter + 1) % 1000;
  return `life-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random()
    .toString(36)
    .substring(2, 8)}`;
}

/** Create a timestamped lifecycle event for a subscription. */
export function createLifecycleEvent(
  subscriptionId: string,
  type: SubscriptionLifecycleEventType,
  details?: string,
  occurredAt: Date = new Date()
): SubscriptionLifecycleEvent {
  return {
    id: generateEventId(),
    subscriptionId,
    type,
    occurredAt,
    details,
  };
}

/** Human-readable label for an event type. */
export function getLifecycleEventLabel(type: SubscriptionLifecycleEventType): string {
  return EVENT_LABELS[type] ?? type;
}

/** Events ordered newest first. */
export function sortLifecycleHistory(
  events: SubscriptionLifecycleEvent[]
): SubscriptionLifecycleEvent[] {
  return [...events].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Export lifecycle events as a CSV string (newest first). */
export function buildLifecycleHistoryCSV(events: SubscriptionLifecycleEvent[]): string {
  const header = 'timestamp,subscriptionId,event,details';
  const rows = sortLifecycleHistory(events).map((event) =>
    [
      event.occurredAt instanceof Date
        ? event.occurredAt.toISOString()
        : new Date(event.occurredAt).toISOString(),
      event.subscriptionId,
      event.type,
      event.details ?? '',
    ]
      .map((value) => csvEscape(String(value)))
      .join(',')
  );
  return [header, ...rows].join('\n');
}

/** Export lifecycle events as a pretty-printed JSON string (newest first). */
export function buildLifecycleHistoryJSON(events: SubscriptionLifecycleEvent[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      eventCount: events.length,
      events: sortLifecycleHistory(events).map((event) => ({
        timestamp: (event.occurredAt instanceof Date
          ? event.occurredAt
          : new Date(event.occurredAt)
        ).toISOString(),
        subscriptionId: event.subscriptionId,
        event: event.type,
        details: event.details ?? null,
      })),
    },
    null,
    2
  );
}
