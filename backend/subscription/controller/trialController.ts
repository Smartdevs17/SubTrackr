/**
 * Trial Controller – trial period management with conversion tracking.
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1118
 */

import type { Request, Response } from 'express';
import { ok, fail, type ApiResponse } from '../../services/shared/apiResponse';
import {
  TrialManagementService,
  trialManagementService as defaultService,
} from '../domain/trialManagementService';
import type { ConversionTrigger, ExtensionCondition, TrialDurationDays } from '../domain/trialManagementService';

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

export class TrialController {
  constructor(private readonly service: TrialManagementService = defaultService) {}

  /** POST /subscriptions/:id/trial */
  startTrial(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const subscriptionId = req.params.id;
    const body = req.body as { userId: string; planId: string; durationDays?: TrialDurationDays };

    if (!subscriptionId || !body.userId || !body.planId) {
      send(res, fail('VALIDATION_ERROR', 'subscriptionId, userId, and planId are required', requestId));
      return;
    }

    try {
      const trial = this.service.startTrial({
        subscriptionId,
        userId: body.userId,
        planId: body.planId,
        durationDays: body.durationDays,
      });
      send(res, ok(trial, requestId), 201);
    } catch (err) {
      send(res, fail('TRIAL_ALREADY_ACTIVE', (err as Error).message, requestId), 409);
    }
  }

  /** POST /trials/:trialId/convert */
  convert(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const trialId = req.params.trialId;
    const body = req.body as { trigger?: ConversionTrigger; revenue?: number };

    try {
      const trial = this.service.convertTrial(
        trialId,
        body.trigger ?? 'manual_upgrade',
        body.revenue,
      );
      send(res, ok(trial, requestId));
    } catch (err) {
      send(res, fail('TRIAL_ERROR', (err as Error).message, requestId), 404);
    }
  }

  /** POST /trials/:trialId/cancel */
  cancel(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const trialId = req.params.trialId;

    try {
      const trial = this.service.cancelTrial(trialId);
      send(res, ok(trial, requestId));
    } catch (err) {
      send(res, fail('TRIAL_ERROR', (err as Error).message, requestId), 404);
    }
  }

  /** POST /trials/:trialId/extend */
  extend(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const trialId = req.params.trialId;
    const body = req.body as { condition: ExtensionCondition };

    if (!body.condition) {
      send(res, fail('VALIDATION_ERROR', 'condition is required', requestId));
      return;
    }

    try {
      const trial = this.service.extendTrial(trialId, body.condition);
      send(res, ok(trial, requestId));
    } catch (err) {
      send(res, fail('TRIAL_ERROR', (err as Error).message, requestId), 404);
    }
  }

  /** PATCH /trials/:trialId/engagement */
  updateEngagement(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const trialId = req.params.trialId;
    const body = req.body as { score: number };

    if (typeof body.score !== 'number') {
      send(res, fail('VALIDATION_ERROR', 'score is required', requestId));
      return;
    }

    try {
      const trial = this.service.updateEngagement(trialId, body.score);
      send(res, ok(trial, requestId));
    } catch (err) {
      send(res, fail('TRIAL_ERROR', (err as Error).message, requestId), 404);
    }
  }

  /** POST /trials/:trialId/events */
  trackEvent(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const trialId = req.params.trialId;
    const body = req.body as { eventType: 'feature_accessed' | 'dashboard_visited' | 'payment_clicked'; featureName?: string };

    if (!body.eventType) {
      send(res, fail('VALIDATION_ERROR', 'eventType is required', requestId));
      return;
    }

    switch (body.eventType) {
      case 'feature_accessed':
        this.service.trackFeatureAccess(trialId, body.featureName ?? 'unknown');
        break;
      case 'dashboard_visited':
        this.service.trackDashboardVisit(trialId);
        break;
      case 'payment_clicked':
        this.service.trackPaymentClick(trialId);
        break;
      default:
        send(res, fail('VALIDATION_ERROR', `Unknown event type: ${body.eventType}`, requestId));
        return;
    }

    send(res, ok({ tracked: true, eventType: body.eventType }, requestId), 201);
  }

  /** GET /trials/:trialId */
  getTrial(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const trialId = req.params.trialId;

    const trial = this.service.getTrial(trialId);
    if (!trial) {
      send(res, fail('TRIAL_NOT_FOUND', `Trial ${trialId} not found`, requestId), 404);
      return;
    }

    const daysRemaining = this.service.getDaysRemaining(trialId);
    const events = this.service.getFunnelEvents(trialId);
    send(res, ok({ trial, daysRemaining, events }, requestId));
  }

  /** GET /subscriptions/:id/trial */
  getBySubscription(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const subscriptionId = req.params.id;

    const trial = this.service.getActiveTrial(subscriptionId);
    send(res, ok({ trial }, requestId));
  }

  /** GET /users/:userId/trials */
  listByUser(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const userId = req.params.userId;

    const trials = this.service.listByUser(userId);
    send(res, ok(trials, requestId));
  }

  /** GET /trials/analytics */
  analytics(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const summary = this.service.getAnalytics();
    send(res, ok(summary, requestId));
  }

  /** GET /trials/extensions/rules */
  extensionRules(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const rules = this.service.getExtensionRules();
    send(res, ok(rules, requestId));
  }

  /** PATCH /trials/extensions/:ruleId */
  toggleExtensionRule(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const ruleId = req.params.ruleId;
    const body = req.body as { isEnabled: boolean };

    const rule = this.service.setExtensionRuleEnabled(ruleId, body.isEnabled);
    if (!rule) {
      send(res, fail('RULE_NOT_FOUND', `Extension rule ${ruleId} not found`, requestId), 404);
      return;
    }

    send(res, ok(rule, requestId));
  }
}

export const trialController = new TrialController();
