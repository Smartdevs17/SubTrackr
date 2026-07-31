import { createClient, RedisClientType } from 'redis';

type RedisType = RedisClientType | null;

export default class NonceCache {
  private redis: RedisType = null;
  private memory: Map<string, number> = new Map();

  constructor() {
    const url = process.env.REDIS_URL;
    if (url) {
      try {
        const client = createClient({ url });
        client.connect().catch(() => {});
        this.redis = client;
      } catch (e) {
        this.redis = null;
      }
    }
  }

  async has(nonce: string): Promise<boolean> {
    if (this.redis) {
      try {
        const v = await this.redis.get(nonce);
        return v !== null;
      } catch {
        // fallback to memory
      }
    }
    const ts = this.memory.get(nonce);
    if (!ts) return false;
    if (Date.now() > ts) {
      this.memory.delete(nonce);
      return false;
    }
    return true;
  }

  async set(nonce: string, ttlSeconds = 600): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.set(nonce, '1', { EX: ttlSeconds });
        return;
      } catch {
        // fallback
      }
    }
    const expires = Date.now() + ttlSeconds * 1000;
    this.memory.set(nonce, expires);
  }
}
