/**
 * DB-backed idempotency middleware for Express.
 *
 * Problem: the existing `idempotencyService.ts` uses an in-memory Map, which
 * means idempotency receipts are lost on restart and don't work across multiple
 * server instances.
 *
 * Solution: persist receipts to the `idempotency_receipts` table (migration
 * 009_idempotency_receipts.sql). The middleware:
 *   1. Reads the `Idempotency-Key` request header.
 *   2. If a completed receipt exists for that key + request hash → replays
 *      the stored response immediately (HTTP 200 with `X-Idempotent-Replayed: true`).
 *   3. If the key is in-flight → 409 Conflict.
 *   4. If the key was used with a different request body → 422 Unprocessable.
 *   5. Otherwise → inserts a pending record, calls `next()`, and captures the
 *      response body via `res.json` interception so it can be persisted.
 *
 * Uses the same public API as `idempotencyService.ts`
 * (`IDEMPOTENCY_KEY_HEADER`, `hashRequest`) for compatibility.
 *
 * Requires migration: backend/migrations/009_idempotency_receipts.sql
 */

import type { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { IDEMPOTENCY_KEY_HEADER, hashRequest } from '../../services/idempotencyService';

// ── Constants ─────────────────────────────────────────────────────────────────

const WINDOW_MS = 24 * 60 * 60 * 1_000; // 24 hours

// ── Types ─────────────────────────────────────────────────────────────────────

interface Receipt {
  key: string;
  request_hash: string;
  status: 'pending' | 'completed' | 'failed';
  response: unknown | null;
  created_at: Date;
  completed_at: Date | null;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getReceipt(pool: Pool, key: string): Promise<Receipt | null> {
  const { rows } = await pool.query<Receipt>(
    `SELECT key, request_hash, status, response, created_at, completed_at
       FROM idempotency_receipts
      WHERE key = $1
        AND created_at > NOW() - INTERVAL '1 millisecond' * $2`,
    [key, WINDOW_MS],
  );
  return rows[0] ?? null;
}

async function insertPending(pool: Pool, key: string, requestHash: string): Promise<void> {
  await pool.query(
    `INSERT INTO idempotency_receipts (key, request_hash, status)
     VALUES ($1, $2, 'pending')
     ON CONFLICT (key) DO NOTHING`,
    [key, requestHash],
  );
}

async function markCompleted(pool: Pool, key: string, response: unknown): Promise<void> {
  await pool.query(
    `UPDATE idempotency_receipts
        SET status = 'completed', response = $2, completed_at = NOW()
      WHERE key = $1 AND status = 'pending'`,
    [key, JSON.stringify(response)],
  );
}

async function markFailed(pool: Pool, key: string): Promise<void> {
  await pool.query(
    `UPDATE idempotency_receipts SET status = 'failed' WHERE key = $1 AND status = 'pending'`,
    [key],
  );
}

// ── Middleware factory ────────────────────────────────────────────────────────

/**
 * Create an idempotency middleware bound to a specific Postgres pool.
 *
 * Usage:
 * ```ts
 * import { createIdempotencyMiddleware } from './middleware/idempotency';
 *
 * app.post('/payments', createIdempotencyMiddleware(pgPool), async (req, res) => { ... });
 * ```
 */
export function createIdempotencyMiddleware(pool: Pool) {
  return async function idempotencyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const rawKey = req.headers[IDEMPOTENCY_KEY_HEADER.toLowerCase()];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;

    // Routes that don't send the header pass straight through.
    if (!key) {
      next();
      return;
    }

    if (typeof key !== 'string' || key.length === 0 || key.length > 255) {
      res.status(400).json({
        error: `${IDEMPOTENCY_KEY_HEADER} must be a non-empty string of at most 255 characters.`,
      });
      return;
    }

    const requestHash = hashRequest(req.body);

    let existing: Receipt | null = null;
    try {
      existing = await getReceipt(pool, key);
    } catch (err) {
      // DB error — degrade gracefully so the request still goes through.
      console.error('[idempotency] failed to query receipt store:', err);
      next();
      return;
    }

    if (existing) {
      if (existing.request_hash !== requestHash) {
        res.status(422).json({
          error:
            `Idempotency key "${key}" was already used with a different request payload. ` +
            `Use a new key for a different operation.`,
        });
        return;
      }

      if (existing.status === 'pending') {
        res.status(409).json({
          error:
            `A request with idempotency key "${key}" is already in progress. ` +
            `Retry after the original request completes.`,
        });
        return;
      }

      if (existing.status === 'completed') {
        res.setHeader('X-Idempotent-Replayed', 'true');
        res.status(200).json(existing.response);
        return;
      }

      // status === 'failed': allow retry with the same key
    }

    try {
      await insertPending(pool, key, requestHash);
    } catch (err) {
      console.error('[idempotency] failed to insert pending receipt:', err);
      next();
      return;
    }

    // Intercept res.json to capture the response body for persistence.
    const originalJson = res.json.bind(res) as Response['json'];
    let captured = false;

    res.json = function (body?: unknown): Response {
      if (!captured) {
        captured = true;
        const statusCode = res.statusCode;
        if (statusCode >= 200 && statusCode < 300) {
          markCompleted(pool, key, body).catch((err) =>
            console.error('[idempotency] failed to mark receipt completed:', err),
          );
        } else {
          markFailed(pool, key).catch((err) =>
            console.error('[idempotency] failed to mark receipt failed:', err),
          );
        }
      }
      return originalJson(body);
    };

    // Also handle explicit error paths.
    const originalStatus = res.status.bind(res) as Response['status'];
    res.status = function (code: number): Response {
      return originalStatus(code);
    };

    next();
  };
}

// ── Cleanup helper ────────────────────────────────────────────────────────────

/**
 * Delete expired receipts older than `windowMs` (default 24 h).
 * Intended to be called on a schedule (e.g. nightly cron).
 */
export async function purgeExpiredReceipts(
  pool: Pool,
  windowMs = WINDOW_MS,
): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM idempotency_receipts
      WHERE created_at < NOW() - INTERVAL '1 millisecond' * $1`,
    [windowMs],
  );
  return rowCount ?? 0;
}
