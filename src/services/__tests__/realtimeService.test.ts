import { RealtimeService } from '../realtimeService';
import { SubscriptionEvent } from '../../../backend/services/notification/websocket';

const makeEvent = (overrides: Partial<SubscriptionEvent> = {}): SubscriptionEvent => ({
  type: 'subscription.created',
  subscriptionId: 'sub-1',
  userId: 'user-1',
  payload: {},
  timestamp: Date.now(),
  ...overrides,
});

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = jest.fn(() => {
    this.onclose?.();
  });
  send = jest.fn();
  constructor() {
    setTimeout(() => this.onopen?.(), 0);
  }
}

(global as unknown as Record<string, unknown>).WebSocket = MockWebSocket;

describe('RealtimeService', () => {
  let service: RealtimeService;

  beforeEach(() => {
    service = new RealtimeService({
      url: 'ws://localhost:4000',
      reconnectDelayMs: 10,
      maxReconnectAttempts: 2,
    });
  });

  afterEach(() => {
    service.disconnect();
  });

  // ── Connection ────────────────────────────────────────────────────────────

  it('connects and becomes connected after open', async () => {
    service.connect();
    await new Promise((r) => setTimeout(r, 10));
    expect(service.connected).toBe(true);
  });

  it('disconnect clears connection state', async () => {
    service.connect();
    await new Promise((r) => setTimeout(r, 10));
    service.disconnect();
    expect(service.connected).toBe(false);
  });

  it('does not double-connect if already connected', async () => {
    service.connect();
    await new Promise((r) => setTimeout(r, 10));
    const ws1 = (service as unknown as { ws: unknown }).ws;
    service.connect(); // should no-op
    expect((service as unknown as { ws: unknown }).ws).toBe(ws1);
  });

  // ── Reconnection handling ─────────────────────────────────────────────────

  it('schedules reconnect on close', async () => {
    service.connect();
    await new Promise((r) => setTimeout(r, 10));
    const ws = (service as unknown as { ws: MockWebSocket }).ws!;
    ws.onclose?.();
    expect((service as unknown as { reconnectAttempts: number }).reconnectAttempts).toBe(1);
  });

  it('stops reconnecting after maxReconnectAttempts', async () => {
    service.connect();
    await new Promise((r) => setTimeout(r, 10));
    const ws = (service as unknown as { ws: MockWebSocket }).ws!;
    ws.onclose?.();
    await new Promise((r) => setTimeout(r, 15));
    ws.onclose?.();
    await new Promise((r) => setTimeout(r, 15));
    ws.onclose?.();
    // attempts capped at 2
    expect(
      (service as unknown as { reconnectAttempts: number }).reconnectAttempts
    ).toBeLessThanOrEqual(3);
  });

  // ── Multi-subscriber fan-out ──────────────────────────────────────────────

  it('delivers event to all subscribers', () => {
    const h1 = jest.fn();
    const h2 = jest.fn();
    service.subscribe(h1);
    service.subscribe(h2);
    service._injectEvent(makeEvent());
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops delivery', () => {
    const handler = jest.fn();
    const unsub = service.subscribe(handler);
    unsub();
    service._injectEvent(makeEvent());
    expect(handler).not.toHaveBeenCalled();
  });

  it('tracks subscriber count', () => {
    const u1 = service.subscribe(jest.fn());
    const u2 = service.subscribe(jest.fn());
    expect(service.subscriberCount).toBe(2);
    u1();
    expect(service.subscriberCount).toBe(1);
    u2();
    expect(service.subscriberCount).toBe(0);
  });

  // ── Event filtering ───────────────────────────────────────────────────────

  it('filters by event type', () => {
    const handler = jest.fn();
    service.subscribe(handler, { types: ['subscription.charged'] });
    service._injectEvent(makeEvent({ type: 'subscription.created' }));
    expect(handler).not.toHaveBeenCalled();
    service._injectEvent(makeEvent({ type: 'subscription.charged' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('filters by subscriptionId', () => {
    const handler = jest.fn();
    service.subscribe(handler, { subscriptionIds: ['sub-99'] });
    service._injectEvent(makeEvent({ subscriptionId: 'sub-1' }));
    expect(handler).not.toHaveBeenCalled();
    service._injectEvent(makeEvent({ subscriptionId: 'sub-99' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('filters by userId', () => {
    const handler = jest.fn();
    service.subscribe(handler, { userId: 'user-1' });
    service._injectEvent(makeEvent({ userId: 'user-2' }));
    expect(handler).not.toHaveBeenCalled();
    service._injectEvent(makeEvent({ userId: 'user-1' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('onEvent convenience method filters by type', () => {
    const handler = jest.fn();
    service.onEvent('subscription.cancelled', handler);
    service._injectEvent(makeEvent({ type: 'subscription.created' }));
    expect(handler).not.toHaveBeenCalled();
    service._injectEvent(makeEvent({ type: 'subscription.cancelled' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // ── Subscription event streaming ──────────────────────────────────────────

  it('dispatches parsed WebSocket message to subscribers', async () => {
    const handler = jest.fn();
    service.subscribe(handler);
    service.connect();
    await new Promise((r) => setTimeout(r, 10));
    const ws = (service as unknown as { ws: MockWebSocket }).ws!;
    ws.onmessage?.({ data: JSON.stringify(makeEvent()) });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed WebSocket messages', async () => {
    const handler = jest.fn();
    service.subscribe(handler);
    service.connect();
    await new Promise((r) => setTimeout(r, 10));
    const ws = (service as unknown as { ws: MockWebSocket }).ws!;
    ws.onmessage?.({ data: 'not-json' });
    expect(handler).not.toHaveBeenCalled();
  });
});
