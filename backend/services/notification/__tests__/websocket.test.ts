import { WebSocketServer, SubscriptionEvent } from '../websocket';

const makeEvent = (overrides: Partial<SubscriptionEvent> = {}): SubscriptionEvent => ({
  type: 'subscription.created',
  subscriptionId: 'sub-1',
  userId: 'user-1',
  payload: {},
  timestamp: Date.now(),
  ...overrides,
});

describe('WebSocketServer', () => {
  let server: WebSocketServer;

  beforeEach(() => {
    server = new WebSocketServer();
  });

  // ── Connection / presence ─────────────────────────────────────────────────

  it('connects a client and tracks presence', () => {
    server.connect('c1', 'u1', jest.fn());
    expect(server.isConnected('c1')).toBe(true);
    expect(server.clientCount).toBe(1);
  });

  it('disconnects a client', () => {
    server.connect('c1', 'u1', jest.fn());
    server.disconnect('c1');
    expect(server.isConnected('c1')).toBe(false);
    expect(server.clientCount).toBe(0);
  });

  it('getPresence returns all connected clients', () => {
    server.connect('c1', 'u1', jest.fn());
    server.connect('c2', 'u2', jest.fn());
    const presence = server.getPresence();
    expect(presence).toHaveLength(2);
    expect(presence.map((p) => p.id)).toContain('c1');
  });

  it('emits presence join event on connect', () => {
    const handler = jest.fn();
    server.on('presence', handler);
    server.connect('c1', 'u1', jest.fn());
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'join', clientId: 'c1' }));
  });

  it('emits presence leave event on disconnect', () => {
    const handler = jest.fn();
    server.connect('c1', 'u1', jest.fn());
    server.on('presence', handler);
    server.disconnect('c1');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'leave', clientId: 'c1' })
    );
  });

  // ── Event streaming ───────────────────────────────────────────────────────

  it('broadcasts event to all connected clients', () => {
    const send1 = jest.fn();
    const send2 = jest.fn();
    server.connect('c1', 'u1', send1);
    server.connect('c2', 'u2', send2);
    const delivered = server.broadcast(makeEvent());
    expect(delivered).toBe(2);
    expect(send1).toHaveBeenCalledTimes(1);
    expect(send2).toHaveBeenCalledTimes(1);
  });

  it('returns 0 delivered when no clients connected', () => {
    expect(server.broadcast(makeEvent())).toBe(0);
  });

  it('supports multiple subscribers per event', () => {
    const sends = [jest.fn(), jest.fn(), jest.fn()];
    sends.forEach((s, i) => server.connect(`c${i}`, 'u1', s));
    server.broadcast(makeEvent());
    sends.forEach((s) => expect(s).toHaveBeenCalledTimes(1));
  });

  // ── Event filtering ───────────────────────────────────────────────────────

  it('filters by event type', () => {
    const send = jest.fn();
    server.connect('c1', 'u1', send, { types: ['subscription.charged'] });
    server.broadcast(makeEvent({ type: 'subscription.created' }));
    expect(send).not.toHaveBeenCalled();
    server.broadcast(makeEvent({ type: 'subscription.charged' }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('filters by subscriptionId', () => {
    const send = jest.fn();
    server.connect('c1', 'u1', send, { subscriptionIds: ['sub-99'] });
    server.broadcast(makeEvent({ subscriptionId: 'sub-1' }));
    expect(send).not.toHaveBeenCalled();
    server.broadcast(makeEvent({ subscriptionId: 'sub-99' }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('filters by userId', () => {
    const send = jest.fn();
    server.connect('c1', 'u1', send, { userId: 'u1' });
    server.broadcast(makeEvent({ userId: 'u2' }));
    expect(send).not.toHaveBeenCalled();
    server.broadcast(makeEvent({ userId: 'u1' }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('updates filter for a connected client', () => {
    const send = jest.fn();
    server.connect('c1', 'u1', send, { types: ['subscription.created'] });
    server.setFilter('c1', { types: ['subscription.cancelled'] });
    server.broadcast(makeEvent({ type: 'subscription.created' }));
    expect(send).not.toHaveBeenCalled();
    server.broadcast(makeEvent({ type: 'subscription.cancelled' }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('throws when setting filter for unknown client', () => {
    expect(() => server.setFilter('ghost', {})).toThrow();
  });

  it('emits broadcast event with delivery count', () => {
    const handler = jest.fn();
    server.on('broadcast', handler);
    server.connect('c1', 'u1', jest.fn());
    server.broadcast(makeEvent());
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ delivered: 1 }));
  });
});
