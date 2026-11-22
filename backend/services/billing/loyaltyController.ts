import type { Request, Response } from 'express';
import { ok, fail, ERROR_HTTP_STATUS_MAP, type ApiResponse } from '../shared/apiResponse';
import { LoyaltyService, loyaltyService as defaultService } from './loyaltyService';
import type { LoyaltyPointsRule, LoyaltyRewardDefinition, LoyaltyTierDefinition } from './loyaltyService';

type RewardsPayload = {
  rewards: readonly LoyaltyRewardDefinition[];
  tiers: readonly LoyaltyTierDefinition[];
};

function requestIdFrom(req: Request): string | undefined {
  return (req.headers['x-request-id'] as string) ?? undefined;
}

function send<T>(res: Response, response: ApiResponse<T>, status = 200): void {
  res.status(response.success ? status : ERROR_HTTP_STATUS_MAP[response.error.code]).json(response);
}

function sendMutation(
  res: Response,
  result: ReturnType<LoyaltyService['awardPoints']>,
  requestId?: string,
  successStatus = 200
): void {
  if (!result.accepted) {
    send(res, fail('CONFLICT', result.error ?? 'Loyalty operation rejected', requestId));
    return;
  }
  send(res, ok(result, requestId), successStatus);
}

export class LoyaltyController {
  constructor(private readonly service: LoyaltyService = defaultService) {}

  getRewards(_req: Request, res: Response): void {
    const payload: RewardsPayload = { rewards: this.service.getRewards(), tiers: this.service.getTiers() };
    send(res, ok(payload));
  }

  getBalance(req: Request, res: Response): void {
    const subscriberId = req.params.subscriberId;
    if (!subscriberId) {
      send(res, fail('VALIDATION_ERROR', 'subscriberId is required', requestIdFrom(req)));
      return;
    }
    send(res, ok(this.service.getBalance(subscriberId), requestIdFrom(req)));
  }

  getTier(req: Request, res: Response): void {
    const subscriberId = req.params.subscriberId;
    if (!subscriberId) {
      send(res, fail('VALIDATION_ERROR', 'subscriberId is required', requestIdFrom(req)));
      return;
    }
    send(res, ok({ tier: this.service.getTier(subscriberId) }, requestIdFrom(req)));
  }

  awardPoints(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const { subscriberId, trigger, context } = req.body as {
      subscriberId?: string;
      trigger?: LoyaltyPointsRule['trigger'];
      context?: { chargeAmount?: number; tenureDays?: number; usageUnits?: number };
    };
    if (!subscriberId || !trigger) {
      send(res, fail('VALIDATION_ERROR', 'subscriberId and trigger are required', requestId));
      return;
    }
    sendMutation(res, this.service.awardPoints(subscriberId, trigger, context), requestId, 201);
  }

  redeemReward(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const { subscriberId, rewardId } = req.body as { subscriberId?: string; rewardId?: string };
    if (!subscriberId || !rewardId) {
      send(res, fail('VALIDATION_ERROR', 'subscriberId and rewardId are required', requestId));
      return;
    }
    sendMutation(res, this.service.redeemReward(subscriberId, rewardId), requestId);
  }

  expirePoints(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const { subscriberId, points, reason } = req.body as {
      subscriberId?: string;
      points?: number;
      reason?: string;
    };
    if (!subscriberId || typeof points !== 'number') {
      send(res, fail('VALIDATION_ERROR', 'subscriberId and points are required', requestId));
      return;
    }
    sendMutation(res, this.service.expirePoints(subscriberId, points, reason), requestId);
  }

  getHistory(req: Request, res: Response): void {
    const subscriberId = req.params.subscriberId;
    if (!subscriberId) {
      send(res, fail('VALIDATION_ERROR', 'subscriberId is required', requestIdFrom(req)));
      return;
    }
    send(res, ok(this.service.getPointsHistory(subscriberId), requestIdFrom(req)));
  }

  getAnalytics(_req: Request, res: Response): void {
    send(res, ok(this.service.getLoyaltyAnalytics()));
  }

  getNotifications(req: Request, res: Response): void {
    const subscriberId = req.params.subscriberId;
    if (!subscriberId) {
      send(res, fail('VALIDATION_ERROR', 'subscriberId is required', requestIdFrom(req)));
      return;
    }
    send(res, ok(this.service.getNotifications(subscriberId), requestIdFrom(req)));
  }

  markNotificationRead(req: Request, res: Response): void {
    const notificationId = req.params.notificationId;
    if (!notificationId) {
      send(res, fail('VALIDATION_ERROR', 'notificationId is required', requestIdFrom(req)));
      return;
    }
    this.service.markNotificationRead(notificationId);
    send(res, ok({ notificationId, isRead: true }, requestIdFrom(req)));
  }
}

export const loyaltyController = new LoyaltyController();
