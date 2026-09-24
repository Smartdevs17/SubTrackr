/**
 * Cancellation Controller – subscription cancellation flow with retention hooks.
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1119
 */

import type { Request, Response } from 'express';
import { ok, fail, type ApiResponse } from '../../services/shared/apiResponse';
import {
  CancellationService,
  cancellationService as defaultService,
} from '../domain/cancellationService';
import type { CancellationMode, CancellationReason } from '../domain/cancellationService';

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

export class CancellationController {
  constructor(private readonly service: CancellationService = defaultService) {}

  /** POST /subscriptions/:id/cancel */
  cancel(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const subscriptionId = req.params.id;
    const body = req.body as {
      userId: string;
      mode?: CancellationMode;
      reason?: CancellationReason;
      nextBillingDate?: string;
    };

    if (!subscriptionId || !body.userId) {
      send(res, fail('VALIDATION_ERROR', 'subscriptionId and userId are required', requestId));
      return;
    }

    try {
      const result = this.service.initiate({
        subscriptionId,
        userId: body.userId,
        mode: body.mode ?? 'end_of_period',
        reason: body.reason,
        nextBillingDate: body.nextBillingDate,
      });
      send(res, ok(result, requestId), 201);
    } catch (err) {
      send(
        res,
        fail('SUBSCRIPTION_ALREADY_CANCELLED', (err as Error).message, requestId),
        409,
      );
    }
  }

  /** POST /subscriptions/:id/cancel/revert */
  revert(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const subscriptionId = req.params.id;

    const cancellation = this.service.getActiveCancellation(subscriptionId);
    if (!cancellation) {
      send(res, fail('CANCELLATION_NOT_FOUND', 'No active cancellation found', requestId), 404);
      return;
    }

    try {
      const reverted = this.service.revert(cancellation.id);
      send(res, ok(reverted, requestId));
    } catch (err) {
      send(res, fail('CANCELLATION_REVERT_FAILED', (err as Error).message, requestId));
    }
  }

  /** POST /subscriptions/:id/cancel/feedback */
  feedback(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const subscriptionId = req.params.id;
    const body = req.body as {
      reason: CancellationReason;
      comment?: string;
      rating?: number;
    };

    if (!subscriptionId || !body.reason) {
      send(res, fail('VALIDATION_ERROR', 'subscriptionId and reason are required', requestId));
      return;
    }

    try {
      const feedback = this.service.submitFeedback({
        subscriptionId,
        reason: body.reason,
        comment: body.comment,
        rating: body.rating,
      });
      send(res, ok(feedback, requestId), 201);
    } catch (err) {
      send(res, fail('VALIDATION_ERROR', (err as Error).message, requestId));
    }
  }

  /** POST /retention/:offerId/accept */
  acceptOffer(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const offerId = req.params.offerId;

    try {
      const result = this.service.acceptOffer(offerId);
      send(res, ok(result, requestId));
    } catch (err) {
      send(res, fail('OFFER_ERROR', (err as Error).message, requestId), 404);
    }
  }

  /** POST /retention/:offerId/decline */
  declineOffer(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const offerId = req.params.offerId;

    try {
      const offer = this.service.declineOffer(offerId);
      send(res, ok(offer, requestId));
    } catch (err) {
      send(res, fail('OFFER_ERROR', (err as Error).message, requestId), 404);
    }
  }

  /** GET /subscriptions/:id/cancel/status */
  status(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const subscriptionId = req.params.id;

    const cancellation = this.service.getActiveCancellation(subscriptionId);
    const offers = this.service.listOffers(subscriptionId);
    send(res, ok({ cancellation, offers }, requestId));
  }

  /** GET /subscriptions/:id/cancel/history */
  history(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const subscriptionId = req.params.id;

    const cancellations = this.service.listCancellations(subscriptionId);
    const feedback = this.service.getFeedback(subscriptionId);
    send(res, ok({ cancellations, feedback }, requestId));
  }

  /** GET /cancellation/analytics */
  analytics(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const report = this.service.getAnalytics();
    send(res, ok(report, requestId));
  }
}

export const cancellationController = new CancellationController();
