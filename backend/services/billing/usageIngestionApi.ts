/**
 * POST /v1/usage — usage event ingestion endpoint.
 *
 * Accepts a single event or a batch (`{ events: [...] }`), deduplicates by
 * idempotency key, and records each event with MeteringService. Mirrors the
 * envelope/middleware conventions used by idempotencyMiddleware.ts.
 */
import type { Request, Response } from 'express';
import { fail, ok } from '../shared/apiResponse';
import { MeteringService, UsageIngestResult, meteringService } from './meteringService';

const MAX_BATCH_SIZE = 500;

export interface UsageEventPayload {
  userId: string;
  metricType: 'api' | 'compute' | 'storage';
  amount: number;
  /** ISO-8601 timestamp of when the usage actually occurred (client clock). */
  timestamp: string;
  idempotencyKey: string;
}

export interface UsageIngestResponse {
  accepted: number;
  duplicate: number;
  rejected: number;
  results: UsageIngestResult[];
}

function parseEvents(body: unknown): UsageEventPayload[] | null {
  if (body && typeof body === 'object' && Array.isArray((body as any).events)) {
    return (body as any).events;
  }
  if (body && typeof body === 'object' && 'userId' in (body as object)) {
    return [body as UsageEventPayload];
  }
  return null;
}

function validateEvent(event: UsageEventPayload): string | null {
  if (!event || typeof event !== 'object') return 'event must be an object';
  if (!event.userId) return 'userId is required';
  if (!event.metricType) return 'metricType is required';
  if (!event.idempotencyKey) return 'idempotencyKey is required';
  if (typeof event.amount !== 'number' || !Number.isFinite(event.amount) || event.amount < 0) {
    return 'amount must be a non-negative finite number';
  }
  if (!event.timestamp || Number.isNaN(new Date(event.timestamp).getTime())) {
    return 'timestamp must be a valid ISO-8601 date string';
  }
  return null;
}

export async function handleUsageIngestion(
  req: Request,
  res: Response,
  service: MeteringService = meteringService
): Promise<void> {
  const requestId = (req.headers['x-request-id'] as string) ?? undefined;
  const events = parseEvents(req.body);

  if (!events) {
    res.status(422).json(fail('USAGE_INVALID_EVENT', 'Request body must be a usage event or { events: [...] }', requestId));
    return;
  }

  if (events.length > MAX_BATCH_SIZE) {
    res
      .status(413)
      .json(fail('USAGE_BATCH_TOO_LARGE', `Batch of ${events.length} exceeds maximum of ${MAX_BATCH_SIZE}`, requestId));
    return;
  }

  const results: UsageIngestResult[] = [];

  for (const event of events) {
    const validationError = validateEvent(event);
    if (validationError) {
      results.push({ idempotencyKey: event?.idempotencyKey ?? 'unknown', status: 'rejected', reason: validationError });
      continue;
    }

    const [result] = await service.recordUsageBatch([
      {
        userId: event.userId,
        metricType: event.metricType,
        amount: event.amount,
        timestamp: new Date(event.timestamp),
        idempotencyKey: event.idempotencyKey,
      },
    ]);
    results.push(result);
  }

  const response: UsageIngestResponse = {
    accepted: results.filter((r) => r.status === 'accepted').length,
    duplicate: results.filter((r) => r.status === 'duplicate').length,
    rejected: results.filter((r) => r.status === 'rejected').length,
    results,
  };

  res.status(202).json(ok(response, requestId));
}
