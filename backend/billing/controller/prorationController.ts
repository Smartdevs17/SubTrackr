/**
 * Proration Controller – subscription upgrade / downgrade endpoints.
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1117
 */

import type { Request, Response } from 'express';
import { ok, fail, type ApiResponse } from '../../services/shared/apiResponse';
import { ProrationService, prorationService as defaultService } from '../domain/prorationService';
import type { ProrationCalculationRequest } from '../../../src/types/prorationCalculator';

function requestIdFrom(req: Request): string | undefined {
  return (req.headers['x-request-id'] as string) ?? undefined;
}

function send<T>(res: Response, response: ApiResponse<T>, statusOverride?: number): void {
  if (response.success) {
    res.status(statusOverride ?? 200).json(response);
    return;
  }
  res.status(statusOverride ?? 400).json(response);
}

export class ProrationController {
  constructor(private readonly service: ProrationService = defaultService) {}

  /** POST /subscriptions/:id/proration/preview */
  preview(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const subscriptionId = req.params.id;
    const body = req.body as Partial<ProrationCalculationRequest>;

    if (!subscriptionId) {
      send(res, fail('VALIDATION_ERROR', 'Subscription ID is required', requestId));
      return;
    }

    if (
      typeof body.currentPlanId !== 'string' ||
      typeof body.currentPlanName !== 'string' ||
      typeof body.currentPrice !== 'number' ||
      typeof body.newPlanId !== 'string' ||
      typeof body.newPlanName !== 'string' ||
      typeof body.newPrice !== 'number' ||
      !body.cycleStartDate ||
      !body.cycleEndDate
    ) {
      send(
        res,
        fail(
          'VALIDATION_ERROR',
          'currentPlanId, currentPlanName, currentPrice, newPlanId, newPlanName, newPrice, cycleStartDate, and cycleEndDate are required',
          requestId,
        ),
      );
      return;
    }

    const result = this.service.preview({
      ...body,
      subscriptionId,
    } as ProrationCalculationRequest);

    send(res, ok(result, requestId));
  }

  /** POST /subscriptions/:id/proration/apply */
  apply(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const subscriptionId = req.params.id;
    const body = req.body as Partial<ProrationCalculationRequest>;

    if (!subscriptionId) {
      send(res, fail('VALIDATION_ERROR', 'Subscription ID is required', requestId));
      return;
    }

    const record = this.service.calculateAndStore({
      ...body,
      subscriptionId,
    } as ProrationCalculationRequest);

    send(res, ok(record, requestId), 201);
  }

  /** PATCH /subscriptions/:id/proration/:recordId/confirm */
  confirm(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const recordId = req.params.recordId;

    const record = this.service.apply(recordId);
    if (!record) {
      send(res, fail('PRORATION_NOT_FOUND', `Proration record "${recordId}" not found`, requestId), 404);
      return;
    }

    send(res, ok(record, requestId));
  }

  /** DELETE /subscriptions/:id/proration/:recordId */
  cancel(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const recordId = req.params.recordId;

    const record = this.service.cancel(recordId);
    if (!record) {
      send(res, fail('PRORATION_NOT_FOUND', `Proration record "${recordId}" not found`, requestId), 404);
      return;
    }

    send(res, ok(record, requestId));
  }

  /** GET /subscriptions/:id/proration/history */
  history(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const subscriptionId = req.params.id;
    const records = this.service.listBySubscription(subscriptionId);
    send(res, ok(records, requestId));
  }

  /** GET /proration/analytics */
  analytics(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const summary = this.service.getAnalytics();
    send(res, ok(summary, requestId));
  }
}

export const prorationController = new ProrationController();
