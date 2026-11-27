import { EventDrivenWsServer, MockRedisPubSubAdapter } from '../eventDrivenWsServer';
import type { RedisPubSubAdapter } from '../redisPubSubAdapter';
import type { AuthUser } from '../../shared/authStrategies';

class SharedPubSub implements RedisPubSubAdapter {
  private static handlers = new Map<string, Set<(channel: string, message: string) => void>>();
  static reset(): void { SharedPubSub.handlers.clear(); }
  async publish(channel: string, message: string): Promise<void> {
    for (const handler of SharedPubSub.handlers.get(channel) ?? []) handler(channel, message);
  }
  async subscribe(channel: string, handler: (channel: string, message: string) => void): Promise<void> {
    const handlers = SharedPubSub.handlers.get(channel) ?? new Set();
    handlers.add(handler);
    SharedPubSub.handlers.set(channel, handlers);
  }
  async close(): Promise<void> { SharedPubSub.handlers.clear(); }
}

const event = {
  type: 'subscription.created' as const,
  subscriptionId: 'sub-1',
  userId: 'user-1',
  payload: { plan: 'pro' },
  timestamp: 1,
};

function connection(clientId: string, send: jest.Mock): Parameters<EventDrivenWsServer['registerConnection']>[0] {
  return {
    clientId,
    user: { id: 'user-1' } as AuthUser,
    lastPing: Date.now(),
    isAlive: true,
    filter: { userId: 'user-1' },
    send,
    close: jest.fn(),
  };
}

describe('EventDrivenWsServer Redis Pub/Sub integration', () => {
  afterEach(() => SharedPubSub.reset());

  it('delivers an event published by one server to connections on another server', async () => {
    const publisher = new EventDrivenWsServer(new SharedPubSub());
    const receiver = new EventDrivenWsServer(new SharedPubSub());
    const send = jest.fn();
    await Promise.all([publisher.ready, receiver.ready]);
    receiver.registerConnection(connection('client-2', send));

    const published = await publisher.publishEvent(event);

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: event.type,
      subscriptionId: event.subscriptionId,
      sequenceId: published.sequenceId,
    }));
    await Promise.all([publisher.shutdown(), receiver.shutdown()]);
  });

  it('does not deliver events that fail the local connection filter', async () => {
    const server = new EventDrivenWsServer(new SharedPubSub());
    const send = jest.fn();
    await server.ready;
    server.registerConnection({
      ...connection('client-3', send),
      filter: { userId: 'different-user' },
    });

    await server.publishEvent(event);

    expect(send).not.toHaveBeenCalled();
    await server.shutdown();
  });

  it('keeps the in-memory adapter available for local development', async () => {
    const server = new EventDrivenWsServer(new MockRedisPubSubAdapter());
    await server.ready;
    expect(server.activeConnectionsCount).toBe(0);
    await server.shutdown();
  });
});
