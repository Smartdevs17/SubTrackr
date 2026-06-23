import * as http from 'http';
import Redis from 'ioredis';
import { Pool, PoolClient } from 'pg';
import { HttpWebhookDispatcher } from './dispatchers/http';

// ─── Configuration ────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_STREAM_KEY = process.env.REDIS_STREAM_KEY || 'webhook:events';
const REDIS_CONSUMER_GROUP = process.env.REDIS_CONSUMER_GROUP || 'webhook-dispatchers';
const CONSUMER_NAME = process.env.CONSUMER_NAME || `dispatcher-${process.pid}-${Date.now()}`;
const CONCURRENCY = parseInt(process.env.DISPATCHER_CONCURRENCY || '10', 10);
const MAX_CONCURRENCY = Math.min(CONCURRENCY, 50);
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/webhook_dispatcher';
const PORT = parseInt(process.env.PORT || '3001', 10);
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '30000', 10);
const QUEUE_BUFFER_SIZE = parseInt(process.env.QUEUE_BUFFER_SIZE || '100000', 10);

// ─── Metrics ──────────────────────────────────────────────────────────────────

const metrics = {
  uptime: 0,
  deliveriesTotal: 0,
  deliveriesSuccess: 0,
  deliveriesFailed: 0,
  deliveriesInFlight: 0,
  queueDepth: 0,
  activeWorkers: 0,
  errorRate: 0,
};

function updateErrorRate(): void {
  const total = metrics.deliveriesSuccess + metrics.deliveriesFailed;
  metrics.errorRate = total > 0 ? metrics.deliveriesFailed / total : 0;
}

// ─── Database ─────────────────────────────────────────────────────────────────

const dbPool = new Pool({ connectionString: DATABASE_URL, max: 10 });

async function setupDatabase(): Promise<void> {
  const client = await dbPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS delivery_logs (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        webhook_url TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        response_code INTEGER,
        error_message TEXT,
        latency_ms INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        delivered_at TIMESTAMPTZ,
        next_retry_at TIMESTAMPTZ,
        signature TEXT,
        idempotency_key TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS retry_state (
        id TEXT PRIMARY KEY,
        event_data JSONB NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_delivery_logs_event_id ON delivery_logs(event_id);
      CREATE INDEX IF NOT EXISTS idx_delivery_logs_status ON delivery_logs(status);
      CREATE INDEX IF NOT EXISTS idx_retry_state_next_retry ON retry_state(next_retry_at);
    `);
    console.log('[DB] Database schema initialized');
  } finally {
    client.release();
  }
}

// ─── Redis Consumer ───────────────────────────────────────────────────────────

const redis = new Redis(REDIS_URL);

async function setupRedisStream(): Promise<void> {
  try {
    await redis.xgroup('CREATE', REDIS_STREAM_KEY, REDIS_CONSUMER_GROUP, '$', 'MKSTREAM');
    console.log(`[Redis] Consumer group "${REDIS_CONSUMER_GROUP}" created`);
  } catch (err: unknown) {
    if ((err as Error).message.includes('BUSYGROUP')) {
      console.log(`[Redis] Consumer group "${REDIS_CONSUMER_GROUP}" already exists`);
    } else {
      throw err;
    }
  }
}

async function updateQueueDepth(): Promise<void> {
  try {
    metrics.queueDepth = await redis.xlen(REDIS_STREAM_KEY);
  } catch {
    metrics.queueDepth = -1;
  }
}

// ─── Webhook Dispatcher ───────────────────────────────────────────────────────

const dispatcher = new HttpWebhookDispatcher({
  maxRetries: 5,
  initialDelayMs: 250,
  maxDelayMs: 8000,
  backoffFactor: 2,
  timeout: 30000,
});

async function processEvent(eventData: Record<string, unknown>): Promise<void> {
  metrics.deliveriesInFlight++;
  metrics.activeWorkers++;
  metrics.deliveriesTotal++;

  const deliveryId = `del_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const idempotencyKey = `${eventData.eventId}:${eventData.webhookId}`;

  try {
    await dbPool.query(
      `INSERT INTO delivery_logs (id, event_id, webhook_url, event_type, payload, status, max_attempts, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [deliveryId, eventData.eventId, eventData.url, eventData.eventType, JSON.stringify(eventData.payload), 5, idempotencyKey]
    );

    const result = await dispatcher.dispatch({
      url: eventData.url as string,
      payload: eventData.payload as Record<string, unknown>,
      headers: eventData.headers as Record<string, string>,
      signature: eventData.signature as string,
      eventType: eventData.eventType as string,
      eventId: eventData.eventId as string,
      idempotencyKey,
    });

    if (result.success) {
      metrics.deliveriesSuccess++;
      await dbPool.query(
        `UPDATE delivery_logs SET status = 'delivered', response_code = $2, latency_ms = $3, delivered_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [deliveryId, result.statusCode, result.latencyMs]
      );
    } else {
      metrics.deliveriesFailed++;
      if (result.statusCode && result.statusCode >= 500) {
        await dbPool.query(
          `INSERT INTO retry_state (id, event_data, attempts, last_error, next_retry_at)
           VALUES ($1, $2, 1, $3, NOW() + INTERVAL '30 seconds')
           ON CONFLICT (id) DO UPDATE SET attempts = retry_state.attempts + 1, last_error = $3, next_retry_at = NOW() + INTERVAL '1 minute'`,
          [deliveryId, JSON.stringify(eventData), result.error || 'Delivery failed']
        );
      }
      await dbPool.query(
        `UPDATE delivery_logs SET status = 'failed', response_code = $2, error_message = $3, updated_at = NOW()
         WHERE id = $1`,
        [deliveryId, result.statusCode, result.error || 'Delivery failed']
      );
    }
  } catch (err: unknown) {
    metrics.deliveriesFailed++;
    console.error(`[Dispatcher] Error processing event:`, (err as Error).message);
  } finally {
    metrics.deliveriesInFlight--;
    metrics.activeWorkers--;
    updateErrorRate();
  }
}

async function consumeEvents(): Promise<void> {
  const activePromises = new Set<Promise<void>>();

  while (true) {
    while (activePromises.size >= MAX_CONCURRENCY) {
      await Promise.race(activePromises);
    }

    try {
      const results = await redis.xreadgroup(
        'GROUP', REDIS_CONSUMER_GROUP, CONSUMER_NAME,
        'COUNT', MAX_CONCURRENCY - activePromises.size,
        'BLOCK', 1000,
        'STREAMS', REDIS_STREAM_KEY, '>'
      );

      if (results) {
        for (const [, messages] of results) {
          for (const [messageId, fields] of messages as [string, string[]][]) {
            const eventData: Record<string, unknown> = {};
            for (let i = 0; i < fields.length; i += 2) {
              try {
                eventData[fields[i]] = JSON.parse(fields[i + 1]);
              } catch {
                eventData[fields[i]] = fields[i + 1];
              }
            }

            const promise = processEvent(eventData)
              .then(() => redis.xack(REDIS_STREAM_KEY, REDIS_CONSUMER_GROUP, messageId))
              .catch((err) => {
                console.error(`[Consumer] Error processing message ${messageId}:`, (err as Error).message);
              })
              .finally(() => activePromises.delete(promise));

            activePromises.add(promise);
          }
        }
      }

      await updateQueueDepth();
    } catch (err: unknown) {
      if (!(err as Error).message?.includes('connection')) {
        console.error('[Consumer] Stream read error:', (err as Error).message);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// ─── HTTP Health Server ───────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    const health = {
      status: 'ok',
      uptime: metrics.uptime,
      queueDepth: metrics.queueDepth,
      activeWorkers: metrics.activeWorkers,
      deliveriesInFlight: metrics.deliveriesInFlight,
      deliveriesTotal: metrics.deliveriesTotal,
      deliveriesSuccess: metrics.deliveriesSuccess,
      deliveriesFailed: metrics.deliveriesFailed,
      errorRate: metrics.errorRate,
      concurrency: MAX_CONCURRENCY,
      consumerName: CONSUMER_NAME,
      timestamp: new Date().toISOString(),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

function gracefulShutdown(signal: string): void {
  console.log(`[Shutdown] Received ${signal}, shutting down gracefully...`);

  const forceExit = setTimeout(() => {
    console.error('[Shutdown] Forced exit after timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  server.close(async () => {
    console.log('[Shutdown] HTTP server closed');

    try {
      await redis.quit();
      console.log('[Shutdown] Redis connection closed');
    } catch (err) {
      console.error('[Shutdown] Error closing Redis:', (err as Error).message);
    }

    try {
      await dbPool.end();
      console.log('[Shutdown] Database connection pool closed');
    } catch (err) {
      console.error('[Shutdown] Error closing database:', (err as Error).message);
    }

    clearTimeout(forceExit);
    console.log('[Shutdown] Graceful shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ─── Startup ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[SubTrackr] Webhook Dispatcher starting...');
  console.log(`[Config] Concurrency: ${MAX_CONCURRENCY}, Stream: ${REDIS_STREAM_KEY}, Group: ${REDIS_CONSUMER_GROUP}`);

  await setupDatabase();
  await setupRedisStream();

  server.listen(PORT, () => {
    console.log(`[HTTP] Health check listening on port ${PORT}`);
    metrics.uptime = Date.now();
  });

  consumeEvents().catch((err) => {
    console.error('[Fatal] Consumer loop crashed:', (err as Error).message);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('[Fatal] Startup failed:', (err as Error).message);
  process.exit(1);
});
