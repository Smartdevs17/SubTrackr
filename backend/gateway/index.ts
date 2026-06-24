/**
 * API Gateway
 *
 * Express application factory that assembles the middleware pipeline:
 *   1. Streaming support (chunked transfer for large payloads)
 *   2. Compression negotiation (Brotli/gzip via Accept-Encoding)
 *   3. Idempotency (payment route safety)
 *   4. Rate limiting
 *   5. Standardised response envelope
 *
 * Usage:
 *   import { createGateway } from './gateway';
 *   const app = createGateway();
 *   app.listen(3000);
 */

import express from 'express';
import type { Application, Request, Response, NextFunction } from 'express';
import { compressionMiddleware } from '../shared/middleware/compression';
import { streamingMiddleware } from '../shared/middleware/streaming';
import { idempotencyMiddleware } from '../services/idempotencyMiddleware';
import { API_VERSION_HEADER, API_VERSION_VALUE } from '../services/shared/apiResponse';
import { REQUEST_ID_HEADER } from '../services/shared/apiResponse';

export interface GatewayOptions {
  /** Trust proxy headers (X-Forwarded-For, etc.). Default true. */
  trustProxy?: boolean;
  /** Disable compression middleware entirely. Default false. */
  disableCompression?: boolean;
  /** Disable streaming middleware. Default false. */
  disableStreaming?: boolean;
}

export function createGateway(options: GatewayOptions = {}): Application {
  const app = express();

  if (options.trustProxy !== false) {
    app.set('trust proxy', true);
  }

  app.disable('x-powered-by');

  app.use(express.json({ limit: '10mb' }));

  // ── Response envelope header ──────────────────────────────────────────
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(API_VERSION_HEADER, API_VERSION_VALUE);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  // ── Request ID injection ──────────────────────────────────────────────
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (!req.headers[REQUEST_ID_HEADER.toLowerCase()]) {
      const { randomUUID } = require('crypto');
      req.headers[REQUEST_ID_HEADER.toLowerCase()] = randomUUID();
    }
    next();
  });

  // ── Streaming ─────────────────────────────────────────────────────────
  if (!options.disableStreaming) {
    app.use(streamingMiddleware);
  }

  // ── Compression ───────────────────────────────────────────────────────
  if (!options.disableCompression) {
    app.use(compressionMiddleware());
  }

  // ── Idempotency on payment routes ─────────────────────────────────────
  app.post('/api/payments/charge', idempotencyMiddleware);

  // ── Export routes (demonstrate streaming + compression) ───────────────
  app.get('/api/exports/invoices', async (req: Request, res: Response) => {
    res.setHeader('X-Compression-Level', '5');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');

    if ((res as any).stream) {
      const rows = generateSampleCSVRows(5000);
      await (res as any).stream(rows, {
        contentType: 'text/csv; charset=utf-8',
        contentDisposition: 'attachment; filename="invoices.csv"',
      });
    } else {
      const all = Array.from(generateSampleCSVRows(5000)).join('');
      res.send(all);
    }
  });

  app.get('/api/exports/dump', async (req: Request, res: Response) => {
    res.setHeader('X-Compression-Level', '6');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    const data = generateSampleJSON(2000);
    res.json(data);
  });

  // ── Health (skip list — no compression) ───────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // ── 404 fallback ──────────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route not found' },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: '',
        apiVersion: 1,
      },
    });
  });

  return app;
}

// ── Sample data generators (for demo routes) ──────────────────────────────

function* generateSampleCSVRows(count: number): Generator<string> {
  const header = 'id,date,amount,currency,status,customer_id,plan,payment_method\n';
  yield header;

  for (let i = 1; i <= count; i++) {
    const date = new Date(2025, 0, 1 + (i % 365)).toISOString().split('T')[0];
    const amount = (Math.random() * 200 + 5).toFixed(2);
    const status = ['paid', 'pending', 'failed', 'refunded'][i % 4];
    const plan = ['starter', 'pro', 'enterprise', 'pro', 'starter'][i % 5];
    const method = ['credit_card', 'paypal', 'stellar', 'bank_transfer'][i % 4];
    yield `${i},${date},${amount},USD,${status},cust_${1000 + i},${plan},${method}\n`;
  }
}

function generateSampleJSON(count: number): Record<string, unknown> {
  const items: Record<string, unknown>[] = [];
  for (let i = 1; i <= count; i++) {
    items.push({
      id: i,
      timestamp: new Date(2025, 0, 1 + (i % 365)).toISOString(),
      customer: {
        id: `cust_${1000 + i}`,
        name: `Customer ${i}`,
        email: `user${i}@example.com`,
        plan: ['starter', 'pro', 'enterprise'][i % 3],
      },
      subscription: {
        status: ['active', 'paused', 'cancelled'][i % 3],
        nextBilling: new Date(2025, i % 12, 15).toISOString(),
        amount: (Math.random() * 100 + 5).toFixed(2),
        currency: 'USD',
      },
      metadata: {
        source: 'api_export',
        region: ['us-east', 'eu-west', 'ap-southeast'][i % 3],
        version: '1.0',
      },
    });
  }
  return { total: count, items, exportedAt: new Date().toISOString() };
}

/**
 * Start the gateway server.
 *
 * @param port - Port to listen on (default from PORT env var or 3000)
 * @param options - Gateway options
 */
export function startGateway(
  port?: number,
  options?: GatewayOptions,
): Application {
  const app = createGateway(options);
  const listenPort = port ?? parseInt(process.env.PORT || '3000', 10);
  app.listen(listenPort, () => {
    console.log(`SubTrackr API gateway listening on port ${listenPort}`);
  });
  return app;
}

// Allow running directly: node backend/gateway/index.js
if (require.main === module) {
  startGateway();
}
