/**
 * POST /v1/usage — high-throughput usage event ingestion endpoint.
 *
 * Accepts a single event or a batch (`{ events: [...] }`), deduplicates by
 * idempotency key, tracks event-time watermarks, and records each event via
 * `MeteringService` or `UsageMeteringPipeline`. Mirrors the envelope/middleware
 * conventions used by `idempotencyMiddleware.ts`.
 */
import type { Request, Response } from 'express';
import { fail, ok } from '../shared/apiResponse';
import { MeteringService, UsageIngestResult, meteringService } from './meteringService';
import { UsageMeteringPipeline, UsageMetricKind } from './usageMeteringPipeline';

const MAX_BATCH_SIZE = 500;

export interface UsageEventPayload {
  userId?: string;
  subscriptionId?: string;
  metricType: UsageMetricKind;
  amount: number;
  /** ISO-8601 timestamp of when the usage actually occurred (client clock). */
  timestamp: string;
  idempotencyKey: string;
  dimensions?: Record<string, string>;
}

export interface UsageIngestResponse {
  accepted: number;
  duplicate: number;
  rejected: number;
  lateRouted?: number;
  droppedLate?: number;
  backpressureRejected?: number;
  results: UsageIngestResult[];
}

function parseEvents(body: unknown): UsageEventPayload[] | null {
  if (body && typeof body === 'object' && Array.isArray((body as { events?: unknown }).events)) {
    return (body as { events: UsageEventPayload[] }).events;
  }
  if (
    body &&
    typeof body === 'object' &&
    ('userId' in (body as object) || 'subscriptionId' in (body as object))
  ) {
    return [body as UsageEventPayload];
  }
  return null;
}

function resolveSubjectId(event: UsageEventPayload): string {
  if (typeof event.userId === 'string' && event.userId.trim().length > 0) {
    return event.userId.trim();
  }
  if (typeof event.subscriptionId === 'string' && event.subscriptionId.trim().length > 0) {
    return event.subscriptionId.trim();
  }
  return '';
}

function validateEvent(event: UsageEventPayload): string | null {
  if (!event || typeof event !== 'object') return 'event must be an object';
  if (!resolveSubjectId(event)) return 'userId is required';
  if (!event.metricType || typeof event.metricType !== 'string') return 'metricType is required';
  if (!event.idempotencyKey || typeof event.idempotencyKey !== 'string') {
    return 'idempotencyKey is required';
  }
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
  service: MeteringService | UsageMeteringPipeline = meteringService
): Promise<void> {
  const requestId = (req.headers?.['x-request-id'] as string) ?? undefined;
  const events = parseEvents(req.body);

  if (!events) {
    res
      .status(422)
      .json(
        fail(
          'USAGE_INVALID_EVENT',
          'Request body must be a usage event or { events: [...] }',
          requestId
        )
      );
    return;
  }

  if (events.length > MAX_BATCH_SIZE) {
    res
      .status(413)
      .json(
        fail(
          'USAGE_BATCH_TOO_LARGE',
          `Batch of ${events.length} exceeds maximum of ${MAX_BATCH_SIZE}`,
          requestId
        )
      );
    return;
  }

  const results: UsageIngestResult[] = [];
  const isDirectPipeline = service instanceof UsageMeteringPipeline;

  for (const event of events) {
    const validationError = validateEvent(event);
    if (validationError) {
      results.push({
        idempotencyKey: event?.idempotencyKey ?? 'unknown',
        status: 'rejected',
        reason: validationError,
      });
      continue;
    }

    const subjectId = resolveSubjectId(event);

    if (isDirectPipeline) {
      const pipelineResult = service.enqueue({
        subscriptionId: subjectId,
        metricType: event.metricType,
        amount: event.amount,
        timestamp: event.timestamp,
        idempotencyKey: event.idempotencyKey,
        dimensions: event.dimensions,
      });
      results.push({
        idempotencyKey: pipelineResult.idempotencyKey,
        status: pipelineResult.status,
        reason: pipelineResult.reason,
        clockSkewDetected: pipelineResult.clockSkewDetected,
        bucketStartMs: pipelineResult.bucketStartMs,
        watermarkMs: pipelineResult.watermarkMs,
        lateEvent: pipelineResult.lateEvent,
      });
    } else {
      const [result] = await service.recordUsageBatch([
        {
          userId: subjectId,
          metricType: event.metricType,
          amount: event.amount,
          timestamp: new Date(event.timestamp),
          idempotencyKey: event.idempotencyKey,
          dimensions: event.dimensions,
        },
      ]);
      results.push(result);
    }
  }

  const pipelineInstance = isDirectPipeline ? service : service.getPipeline();
  const telemetry = pipelineInstance.getMetrics();
  if (typeof res.setHeader === 'function') {
    res.setHeader('X-Metering-Queue-Depth', String(telemetry.pendingQueueDepth));
    res.setHeader('X-Metering-Flushed-Batches', String(telemetry.flushedBatchCount));
  }

  const backpressureRejected = results.filter((r) => r.status === 'backpressure_rejected').length;
  if (results.length > 0 && backpressureRejected === results.length) {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Retry-After', '1');
    }
    res
      .status(429)
      .json(
        fail(
          'RATE_LIMIT_EXCEEDED',
          'Usage metering pipeline queue depth exceeded maximum backpressure threshold',
          requestId
        )
      );
    return;
  }

  const lateRouted = results.filter((r) => r.status === 'late_accepted').length;
  const droppedLate = results.filter((r) => r.status === 'dropped_late').length;

  const response: UsageIngestResponse = {
    accepted: results.filter((r) => r.status === 'accepted' || r.status === 'late_accepted').length,
    duplicate: results.filter((r) => r.status === 'duplicate').length,
    rejected: results.filter(
      (r) =>
        r.status === 'rejected' ||
        r.status === 'dropped_late' ||
        r.status === 'backpressure_rejected'
    ).length,
    lateRouted,
    droppedLate,
    backpressureRejected,
    results,
  };

  res.status(202).json(ok(response, requestId));
}
