/**
 * Redis Pub/Sub adapter for cross-process WebSocket event delivery.
 *
 * Redis requires dedicated connections for publishing and subscribing. The
 * structural client interface keeps this adapter independent of a Redis
 * package and makes its lifecycle easy to test.
 */
import { loadRedisConfig } from '../../config/redis';

export interface RedisPubSubClient {
  publish(channel: string, message: string): Promise<number>;
  ping(): Promise<string>;
  subscribe(channel: string): Promise<number>;
  unsubscribe(channel: string): Promise<number>;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
  removeListener(event: 'message', listener: (channel: string, message: string) => void): unknown;
  quit(): Promise<unknown>;
}

export interface RedisPubSubAdapter {
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (channel: string, message: string) => void): Promise<void>;
  close?(): Promise<void>;
}

export class IORedisPubSubAdapter implements RedisPubSubAdapter {
  private readonly handlers = new Map<string, Set<(channel: string, message: string) => void>>();
  private readonly subscribedChannels = new Set<string>();
  private readonly pendingSubscriptions = new Map<string, Promise<void>>();
  private closed = false;

  private readonly onMessage = (channel: string, message: string): void => {
    for (const handler of this.handlers.get(channel) ?? []) {
      try {
        handler(channel, message);
      } catch {
        // One consumer must not prevent delivery to other local consumers.
      }
    }
  };

  constructor(
    private readonly publisher: RedisPubSubClient,
    private readonly subscriber: RedisPubSubClient,
  ) {
    if (publisher === subscriber) {
      throw new Error('Redis Pub/Sub requires separate publisher and subscriber connections');
    }
    this.subscriber.on('message', this.onMessage);
  }

  async publish(channel: string, message: string): Promise<void> {
    this.assertOpen();
    await this.publisher.publish(channel, message);
  }

  async subscribe(
    channel: string,
    handler: (channel: string, message: string) => void,
  ): Promise<void> {
    this.assertOpen();
    const channelHandlers = this.handlers.get(channel) ?? new Set();
    channelHandlers.add(handler);
    this.handlers.set(channel, channelHandlers);

    if (this.subscribedChannels.has(channel)) return;

    const pending = this.pendingSubscriptions.get(channel);
    if (pending) return pending;

    const subscription = this.subscriber.subscribe(channel).then(() => {
      this.subscribedChannels.add(channel);
    }).catch((error) => {
      this.handlers.delete(channel);
      throw error;
    }).finally(() => {
      this.pendingSubscriptions.delete(channel);
    });

    this.pendingSubscriptions.set(channel, subscription);
    return subscription;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled([...this.pendingSubscriptions.values()]);
    this.subscriber.removeListener('message', this.onMessage);

    const channels = [...this.subscribedChannels];
    await Promise.allSettled(channels.map((channel) => this.subscriber.unsubscribe(channel)));
    this.handlers.clear();
    this.subscribedChannels.clear();

    await Promise.allSettled([this.publisher.quit(), this.subscriber.quit()]);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Redis Pub/Sub adapter is closed');
  }
}

/**
 * Creates independent publisher/subscriber connections from the shared Redis
 * environment configuration. Both connections are owned by the returned adapter.
 */
export async function createRedisPubSubAdapter(): Promise<IORedisPubSubAdapter> {
  const config = loadRedisConfig();
  const ioredisModule = (await import('ioredis')) as {
    default: new (options: Record<string, unknown>) => RedisPubSubClient;
  };
  const Redis = ioredisModule.default;
  const options = {
    host: config.host,
    port: config.port,
    password: config.password,
    db: config.db,
    connectTimeout: config.connectTimeoutMs,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  };

  const publisher = new Redis(options);
  const subscriber = new Redis(options);

  try {
    await Promise.all([publisher.ping?.(), subscriber.ping?.()]);
  } catch (error) {
    await Promise.allSettled([publisher.quit(), subscriber.quit()]);
    throw error;
  }

  return new IORedisPubSubAdapter(publisher, subscriber);
}
