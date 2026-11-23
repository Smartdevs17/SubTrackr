import {
  ClientIngestBatchResult,
  createUsageMeteringClient,
  generateDeterministicIdempotencyKey,
  UsageMeteringClient,
  WireUsageEventPayload,
} from '../usageMeteringClient';

describe('UsageMeteringClient — Client-Side Sub-Second Metering Batcher (#2197)', () => {
  const BASE_NOW = new Date('2026-03-15T12:00:00.000Z').getTime();

  describe('Deterministic Idempotency Key Generation', () => {
    it('generates identical FNV-1a idempotency keys for identical inputs regardless of dimension key order', () => {
      const k1 = generateDeterministicIdempotencyKey({
        subscriptionId: 'sub_123',
        metricType: 'api',
        amount: 42,
        timestamp: new Date(BASE_NOW),
        sequence: 1,
        dimensions: { region: 'us-east-1', endpoint: '/v1/charge' },
      });

      const k2 = generateDeterministicIdempotencyKey({
        subscriptionId: 'sub_123',
        metricType: 'api',
        amount: 42,
        timestamp: BASE_NOW,
        sequence: 1,
        dimensions: { endpoint: '/v1/charge', region: 'us-east-1' },
      });

      const k3 = generateDeterministicIdempotencyKey({
        subscriptionId: 'sub_123',
        metricType: 'api',
        amount: 42,
        timestamp: new Date(BASE_NOW).toISOString(),
        sequence: 1,
        dimensions: { region: 'us-east-1', endpoint: '/v1/charge' },
      });

      expect(k1).toBe(k2);
      expect(k2).toBe(k3);
      expect(k1).toMatch(/^idem_sub_123_api_\d+_[0-9a-f]{8}_1$/);

      // Without sequence or dimensions
      const kNoSeq = generateDeterministicIdempotencyKey({
        subscriptionId: 'sub_123',
        metricType: 'api',
        amount: 42,
        timestamp: 'invalid-date-string',
      });
      expect(kNoSeq).toMatch(/^idem_sub_123_api_0_[0-9a-f]{8}$/);
    });
  });

  describe('Event Buffering, Store Synchronization & Validation', () => {
    it('buffers events via track and trackBatch, updates Zustand store, and flushes in maxBatchSize chunks', async () => {
      const storeCalls: { subscriptionId: string; metric: string; value: number }[] = [];
      const transmittedChunks: WireUsageEventPayload[][] = [];

      const client = createUsageMeteringClient({
        flushIntervalMs: 0,
        maxBatchSize: 3,
        now: () => BASE_NOW,
        store: {
          recordUsage: (subscriptionId, metric, value) => {
            storeCalls.push({ subscriptionId, metric, value });
          },
        },
        transport: async (events): Promise<ClientIngestBatchResult> => {
          transmittedChunks.push(events);
          return {
            accepted: events.length,
            duplicate: 0,
            rejected: 0,
            results: events.map((e) => ({
              idempotencyKey: e.idempotencyKey,
              status: 'accepted',
            })),
          };
        },
      });

      const tracked = client.trackBatch([
        {
          subscriptionId: 'sub_a',
          metricType: 'api',
          amount: 10,
          dimensions: { tier: 'pro' },
        },
        {
          subscriptionId: 'sub_a',
          metricType: 'api',
          amount: 20,
          idempotencyKey: 'explicit_idem_2',
        },
      ]);

      expect(tracked).toHaveLength(2);
      expect(tracked[1].idempotencyKey).toBe('explicit_idem_2');
      expect(client.getPendingCount()).toBe(2);
      expect(storeCalls).toHaveLength(2);

      // 3rd event reaches maxBatchSize (3) and triggers auto-flush
      client.track({
        subscriptionId: 'sub_a',
        metricType: 'api',
        amount: 30,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(transmittedChunks).toHaveLength(1);
      expect(transmittedChunks[0]).toHaveLength(3);
      expect(client.getPendingCount()).toBe(0);
      expect(client.getMetrics().flushedEventCount).toBe(3);

      // Flush on empty queue returns []
      expect(await client.flush()).toEqual([]);
    });

    it('validates input fields and enforces client maxQueueDepth backpressure', () => {
      const client = new UsageMeteringClient({
        flushIntervalMs: 0,
        maxBatchSize: 10,
        maxQueueDepth: 2,
      });

      expect(() =>
        client.track({
          subscriptionId: '  ',
          metricType: 'api',
          amount: 1,
        })
      ).toThrow(/subscriptionId is required/);

      expect(() =>
        client.track({
          subscriptionId: 'sub_1',
          metricType: '',
          amount: 1,
        })
      ).toThrow(/metricType is required/);

      expect(() =>
        client.track({
          subscriptionId: 'sub_1',
          metricType: 'api',
          amount: -5,
        })
      ).toThrow(/amount must be a non-negative finite number/);

      client.track({ subscriptionId: 'sub_1', metricType: 'api', amount: 1 });
      client.track({ subscriptionId: 'sub_1', metricType: 'api', amount: 2 });

      expect(() => client.track({ subscriptionId: 'sub_1', metricType: 'api', amount: 3 })).toThrow(
        /reached maxQueueDepth/
      );
      expect(client.getMetrics().droppedBackpressureCount).toBe(1);
    });

    it('auto-flushes on sub-second timer and supports graceful stop()', async () => {
      const batches: WireUsageEventPayload[][] = [];
      const client = new UsageMeteringClient({
        flushIntervalMs: 25,
        maxBatchSize: 100,
        transport: async (events) => {
          batches.push(events);
          return {
            accepted: events.length,
            duplicate: 0,
            rejected: 0,
            results: events.map((e) => ({ idempotencyKey: e.idempotencyKey, status: 'accepted' })),
          };
        },
      });

      client.track({ subscriptionId: 'sub_timer', metricType: 'api', amount: 5 });
      client.track({ subscriptionId: 'sub_timer', metricType: 'api', amount: 10 });
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(2);

      // Enqueue one more event and immediately call stop() before timer fires
      client.track({ subscriptionId: 'sub_timer', metricType: 'api', amount: 15 });
      const stopRes = await client.stop();
      expect(stopRes).toHaveLength(1);
      expect(client.getPendingCount()).toBe(0);
    });
  });

  describe('Exponential Backoff Retries, Dead-Letter Handling & HTTP Fetch Transport', () => {
    it('retries transient failures with exponential backoff and succeeds when transport recovers', async () => {
      const delays: number[] = [];
      let attempts = 0;

      const client = new UsageMeteringClient({
        flushIntervalMs: 0,
        maxRetries: 3,
        baseRetryDelayMs: 20,
        sleep: async (ms) => {
          delays.push(ms);
        },
        transport: async (events) => {
          attempts += 1;
          if (attempts < 3) {
            throw new Error(`Transient network failure #${attempts}`);
          }
          return {
            accepted: events.length,
            duplicate: 0,
            rejected: 0,
            results: events.map((e) => ({ idempotencyKey: e.idempotencyKey, status: 'accepted' })),
          };
        },
      });

      client.track({ subscriptionId: 'sub_retry', metricType: 'api', amount: 100 });
      const results = await client.flush();

      expect(attempts).toBe(3);
      expect(delays).toEqual([20, 40]);
      expect(results[0].accepted).toBe(1);
      expect(client.getMetrics().retryCount).toBe(2);
      expect(client.getMetrics().deadLetterEventCount).toBe(0);
    });

    it('routes events to dead-letter callback and getDeadLetterEvents() when all retries exhaust', async () => {
      const dlqCallbacks: { events: WireUsageEventPayload[]; error: Error }[] = [];

      const client = new UsageMeteringClient({
        flushIntervalMs: 0,
        maxRetries: 2,
        baseRetryDelayMs: 10,
        sleep: async () => {},
        onDeadLetter: (events, error) => {
          dlqCallbacks.push({ events, error });
        },
        transport: async () => {
          throw new Error('Gateway 503 Unavailable');
        },
      });

      client.track({ subscriptionId: 'sub_dlq', metricType: 'compute', amount: 50 });
      const results = await client.flush();

      expect(results[0].rejected).toBe(1);
      expect(dlqCallbacks).toHaveLength(1);
      expect(dlqCallbacks[0].error.message).toMatch(/Gateway 503 Unavailable/);
      expect(client.getDeadLetterEvents()).toHaveLength(1);
      expect(client.getMetrics().deadLetterEventCount).toBe(1);
    });

    it('transmits batches over HTTP fetchImpl with Authorization header and parses envelope formats', async () => {
      const fetchCalls: { url: string; init?: RequestInit }[] = [];

      // 1. Standard { data: { results: [...] } } envelope
      const mockFetchEnvelope = (async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, init });
        return {
          ok: true,
          status: 202,
          json: async () => ({
            data: {
              accepted: 1,
              duplicate: 0,
              rejected: 0,
              results: [{ idempotencyKey: 'k1', status: 'accepted' }],
            },
          }),
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const client1 = new UsageMeteringClient({
        endpoint: 'https://api.subtrackr.io/v1/usage',
        apiKey: 'secret_token_123',
        flushIntervalMs: 0,
        fetchImpl: mockFetchEnvelope,
      });

      client1.track({
        subscriptionId: 'sub_fetch',
        metricType: 'api',
        amount: 10,
        idempotencyKey: 'k1',
      });
      const res1 = await client1.flush();
      expect(res1[0].accepted).toBe(1);
      expect(fetchCalls[0].url).toBe('https://api.subtrackr.io/v1/usage');
      expect((fetchCalls[0].init?.headers as Record<string, string>).Authorization).toBe(
        'Bearer secret_token_123'
      );

      // 2. Direct { results: [...] } payload + HTTP error status handling
      let callNum = 0;
      const mockFetchDirect = (async () => {
        callNum += 1;
        if (callNum === 1) {
          return {
            ok: false,
            status: 502,
            json: async () => ({}),
          } as unknown as Response;
        }
        if (callNum === 2) {
          return {
            ok: true,
            status: 202,
            json: async () => ({
              accepted: 1,
              duplicate: 0,
              rejected: 0,
              results: [{ idempotencyKey: 'k2', status: 'accepted' }],
            }),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 202,
          json: async () => ({}),
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const client2 = new UsageMeteringClient({
        flushIntervalMs: 0,
        maxRetries: 2,
        sleep: async () => {},
        fetchImpl: mockFetchDirect,
      });

      client2.track({
        subscriptionId: 'sub_fetch',
        metricType: 'api',
        amount: 20,
        idempotencyKey: 'k2',
      });
      const res2 = await client2.flush();
      expect(res2[0].accepted).toBe(1);

      // 3. Fallback when server returns empty JSON object {}
      client2.track({
        subscriptionId: 'sub_fetch',
        metricType: 'api',
        amount: 30,
        idempotencyKey: 'k3',
      });
      const res3 = await client2.flush();
      expect(res3[0].accepted).toBe(1);
    });
  });
});
