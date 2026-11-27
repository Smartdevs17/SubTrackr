import { IORedisPubSubAdapter, RedisPubSubClient } from '../redisPubSubAdapter';

class FakeRedisClient implements RedisPubSubClient {
  readonly listeners = new Set<(channel: string, message: string) => void>();
  readonly published: Array<{ channel: string; message: string }> = [];
  readonly subscriptions: string[] = [];
  readonly unsubscriptions: string[] = [];
  quitCalls = 0;

  async ping(): Promise<string> { return 'PONG'; }
  async publish(channel: string, message: string): Promise<number> {
    this.published.push({ channel, message });
    return 1;
  }
  async subscribe(channel: string): Promise<number> {
    this.subscriptions.push(channel);
    return 1;
  }
  async unsubscribe(channel: string): Promise<number> {
    this.unsubscriptions.push(channel);
    return 1;
  }
  on(_event: 'message', listener: (channel: string, message: string) => void): this {
    this.listeners.add(listener);
    return this;
  }
  removeListener(_event: 'message', listener: (channel: string, message: string) => void): this {
    this.listeners.delete(listener);
    return this;
  }
  async quit(): Promise<string> {
    this.quitCalls++;
    return 'OK';
  }
  emitMessage(channel: string, message: string): void {
    for (const listener of this.listeners) listener(channel, message);
  }
}

describe('IORedisPubSubAdapter', () => {
  it('publishes through the publisher connection', async () => {
    const publisher = new FakeRedisClient();
    const subscriber = new FakeRedisClient();
    const adapter = new IORedisPubSubAdapter(publisher, subscriber);

    await adapter.publish('events', '{"id":1}');

    expect(publisher.published).toEqual([{ channel: 'events', message: '{"id":1}' }]);
    expect(subscriber.published).toHaveLength(0);
    await adapter.close();
  });

  it('subscribes once per channel and dispatches messages to local handlers', async () => {
    const publisher = new FakeRedisClient();
    const subscriber = new FakeRedisClient();
    const adapter = new IORedisPubSubAdapter(publisher, subscriber);
    const first = jest.fn();
    const second = jest.fn();

    await adapter.subscribe('events', first);
    await adapter.subscribe('events', second);
    subscriber.emitMessage('events', 'hello');

    expect(subscriber.subscriptions).toEqual(['events']);
    expect(first).toHaveBeenCalledWith('events', 'hello');
    expect(second).toHaveBeenCalledWith('events', 'hello');
    await adapter.close();
  });

  it('isolates a throwing handler from other handlers', async () => {
    const publisher = new FakeRedisClient();
    const subscriber = new FakeRedisClient();
    const adapter = new IORedisPubSubAdapter(publisher, subscriber);
    const next = jest.fn();

    await adapter.subscribe('events', () => { throw new Error('handler failure'); });
    await adapter.subscribe('events', next);
    subscriber.emitMessage('events', 'hello');

    expect(next).toHaveBeenCalledWith('events', 'hello');
    await adapter.close();
  });

  it('closes both connections and rejects operations after close', async () => {
    const publisher = new FakeRedisClient();
    const subscriber = new FakeRedisClient();
    const adapter = new IORedisPubSubAdapter(publisher, subscriber);
    await adapter.subscribe('events', jest.fn());

    await adapter.close();

    expect(publisher.quitCalls).toBe(1);
    expect(subscriber.quitCalls).toBe(1);
    expect(subscriber.unsubscriptions).toEqual(['events']);
    await expect(adapter.publish('events', 'message')).rejects.toThrow('closed');
  });

  it('rejects using the same connection for publishing and subscribing', () => {
    const client = new FakeRedisClient();
    expect(() => new IORedisPubSubAdapter(client, client)).toThrow('separate');
  });
});
