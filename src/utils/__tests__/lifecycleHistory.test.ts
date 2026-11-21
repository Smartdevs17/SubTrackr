import {
  createLifecycleEvent,
  getLifecycleEventLabel,
  sortLifecycleHistory,
  buildLifecycleHistoryCSV,
  buildLifecycleHistoryJSON,
} from '../lifecycleHistory';
import type { SubscriptionLifecycleEvent } from '../../types/subscription';

function makeEvent(
  overrides: Partial<SubscriptionLifecycleEvent> = {}
): SubscriptionLifecycleEvent {
  return {
    id: 'evt-1',
    subscriptionId: 'sub-1',
    type: 'created',
    occurredAt: new Date('2026-01-01T10:00:00.000Z'),
    ...overrides,
  };
}

describe('createLifecycleEvent', () => {
  it('stamps the subscription, type, details and timestamp', () => {
    const occurredAt = new Date('2026-02-03T12:34:56.000Z');
    const event = createLifecycleEvent('sub-9', 'paused', 'Paused for 14 day(s)', occurredAt);

    expect(event.subscriptionId).toBe('sub-9');
    expect(event.type).toBe('paused');
    expect(event.details).toBe('Paused for 14 day(s)');
    expect(event.occurredAt).toBe(occurredAt);
    expect(event.id).toBeTruthy();
  });

  it('defaults the timestamp to now', () => {
    const before = Date.now();
    const event = createLifecycleEvent('sub-9', 'resumed');
    expect(event.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(event.occurredAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('generates unique ids', () => {
    const a = createLifecycleEvent('sub-1', 'created');
    const b = createLifecycleEvent('sub-1', 'created');
    expect(a.id).not.toBe(b.id);
  });
});

describe('getLifecycleEventLabel', () => {
  it('maps known event types to readable labels', () => {
    expect(getLifecycleEventLabel('price_changed')).toBe('Price changed');
    expect(getLifecycleEventLabel('cancelled')).toBe('Cancelled');
    expect(getLifecycleEventLabel('plan_changed')).toBe('Plan changed');
  });
});

describe('sortLifecycleHistory', () => {
  it('orders events newest first without mutating the input', () => {
    const older = makeEvent({ id: 'old', occurredAt: new Date('2026-01-01T00:00:00.000Z') });
    const newer = makeEvent({ id: 'new', occurredAt: new Date('2026-03-01T00:00:00.000Z') });
    const input = [older, newer];

    const sorted = sortLifecycleHistory(input);

    expect(sorted.map((event) => event.id)).toEqual(['new', 'old']);
    expect(input[0].id).toBe('old');
  });
});

describe('buildLifecycleHistoryCSV', () => {
  it('emits a header plus one row per event, newest first', () => {
    const csv = buildLifecycleHistoryCSV([
      makeEvent({
        id: 'a',
        type: 'created',
        occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      makeEvent({
        id: 'b',
        type: 'price_changed',
        occurredAt: new Date('2026-02-01T00:00:00.000Z'),
        details: '9.99 USD → 12.99 USD',
      }),
    ]);

    const lines = csv.split('\n');
    expect(lines[0]).toBe('timestamp,subscriptionId,event,details');
    expect(lines[1]).toBe('2026-02-01T00:00:00.000Z,sub-1,price_changed,9.99 USD → 12.99 USD');
    expect(lines[2]).toBe('2026-01-01T00:00:00.000Z,sub-1,created,');
  });

  it('quotes details containing commas', () => {
    const csv = buildLifecycleHistoryCSV([
      makeEvent({ type: 'paused', details: 'Paused for 14 days, no charge' }),
    ]);
    expect(csv).toContain('"Paused for 14 days, no charge"');
  });

  it('returns just the header for an empty history', () => {
    expect(buildLifecycleHistoryCSV([])).toBe('timestamp,subscriptionId,event,details');
  });
});

describe('buildLifecycleHistoryJSON', () => {
  it('wraps events with an export timestamp and count', () => {
    const json = buildLifecycleHistoryJSON([
      makeEvent({ type: 'resumed', occurredAt: new Date('2026-05-01T00:00:00.000Z') }),
    ]);

    const parsed = JSON.parse(json);
    expect(parsed.eventCount).toBe(1);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0].event).toBe('resumed');
    expect(parsed.events[0].timestamp).toBe('2026-05-01T00:00:00.000Z');
    expect(typeof parsed.exportedAt).toBe('string');
  });
});
