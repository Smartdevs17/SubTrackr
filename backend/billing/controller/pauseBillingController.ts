/**
 * Pause / resume billing controller (Issue #786).
 * Uses PauseBillingService for credit math, notifications, limits, and analytics.
 */

import type { Request, Response } from 'express';
import {
  ok,
  fail,
  ERROR_HTTP_STATUS_MAP,
  type ApiResponse,
} from '../../services/shared/apiResponse';
import {
  PauseBillingService,
  pauseBillingService as defaultService,
} from '../../../src/services/pauseBillingService';
import type { PauseLimits } from '../../../src/types/pause';
import type {
  BillingAdjustment,
  PauseAnalyticsReport,
  PauseBillingRecord,
  PauseNotification,
  AdjustmentPreview,
} from '../../../src/types/pauseBilling';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function requestIdFrom(req: Request): string | undefined {
  return (req.headers['x-request-id'] as string) ?? undefined;
}

function send<T>(res: Response, response: ApiResponse<T>, statusOverride?: number): void {
  if (response.success) {
    res.status(statusOverride ?? 200).json(response);
    return;
  }
  const status =
    statusOverride ?? ERROR_HTTP_STATUS_MAP[response.error.code] ?? 500;
  res.status(status).json(response);
}

export class PauseBillingController {
  constructor(private readonly service: PauseBillingService = defaultService) {}

  /** POST /subscriptions/:id/pause */
  pause(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const subscriptionId = req.params.id;
    const body = req.body as {
      pauseDays?: number;
      reason?: string;
      price?: number;
      billingCycleDays?: number;
      currency?: string;
      currentNextBillingDate?: string;
    };

    if (
      !subscriptionId ||
      typeof body.pauseDays !== 'number' ||
      typeof body.price !== 'number' ||
      typeof body.billingCycleDays !== 'number' ||
      !body.currency
    ) {
      send(
        res,
        fail(
          'VALIDATION_ERROR',
          'pauseDays, price, billingCycleDays, and currency are required',
          requestId
        )
      );
      return;
    }

    const active = this.service.getActivePause(subscriptionId);
    if (active) {
      send(
        res,
        fail(
          'SUBSCRIPTION_PAUSED',
          'This subscription is already paused',
          requestId
        )
      );
      return;
    }

    const limitsCheck = this.service.enforceLimits(
      this.service.getRecords(subscriptionId),
      body.pauseDays,
      this.service.getLimits(),
      subscriptionId
    );

    if (!limitsCheck.allowed) {
      send(
        res,
        fail('VALIDATION_ERROR', limitsCheck.reason ?? 'Pause not allowed', requestId)
      );
      return;
    }

    const adjustment = this.service.createPauseAdjustment({
      subscriptionId,
      price: body.price,
      billingCycleDays: body.billingCycleDays,
      pauseDays: body.pauseDays,
      currency: body.currency,
      reason: body.reason,
    });

    const resumeAt = new Date(Date.now() + body.pauseDays * MS_PER_DAY);
    const notifications = this.service.scheduleNotifications(
      subscriptionId,
      body.pauseDays,
      resumeAt
    );

    if (limitsCheck.warning) {
      this.service.scheduleLimitWarning(
        subscriptionId,
        'You are approaching the maximum number of pauses allowed this year.'
      );
    }

    send(
      res,
      ok(
        {
          adjustment,
          notifications,
          resumeAt,
          record: this.service.getActivePause(subscriptionId),
        },
        requestId
      ),
      201
    );
  }

  /** POST /subscriptions/:id/resume */
  resume(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const subscriptionId = req.params.id;
    const body = (req.body ?? {}) as {
      early?: boolean;
      currentNextBillingDate?: string;
      billingCycleDays?: number;
      currency?: string;
    };

    const active = this.service.getActivePause(subscriptionId);
    if (!active) {
      send(
        res,
        fail(
          'SUBSCRIPTION_NOT_FOUND',
          'No active pause found for this subscription',
          requestId
        )
      );
      return;
    }

    const now = new Date();
    const daysUsed = Math.max(
      0,
      Math.ceil((now.getTime() - new Date(active.pausedAt).getTime()) / MS_PER_DAY)
    );

    const pauseCredit = this.service
      .getAdjustments(subscriptionId)
      .filter((a) => a.type === 'pause_credit')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    let clawback: BillingAdjustment | undefined;
    const early = body.early === true || daysUsed < active.pauseDays;

    if (early && pauseCredit) {
      clawback = this.service.createEarlyResumeAdjustment(pauseCredit, daysUsed);
    }

    const shiftDays = early ? daysUsed : active.pauseDays;
    const currentNext =
      body.currentNextBillingDate != null
        ? new Date(body.currentNextBillingDate)
        : new Date(now.getTime() + (body.billingCycleDays ?? 30) * MS_PER_DAY);

    const restart = this.service.createResumeRestart({
      subscriptionId,
      pauseDays: shiftDays,
      currentNextBillingDate: currentNext,
      currency: body.currency ?? active.currency,
      billingCycleDays: body.billingCycleDays ?? pauseCredit?.periodDays ?? 30,
      early,
    });

    send(
      res,
      ok(
        {
          clawback,
          restart,
          nextBillingDate: restart.nextBillingDate,
          daysUsed: shiftDays,
          early,
        },
        requestId
      )
    );
  }

  /** GET /subscriptions/:id/pause/preview */
  preview(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const subscriptionId = req.params.id;
    const pauseDays = Number(req.query.pauseDays);
    const price = Number(req.query.price);
    const billingCycleDays = Number(req.query.billingCycleDays ?? 30);
    const currency = (req.query.currency as string) || 'USD';

    if (!subscriptionId || Number.isNaN(pauseDays) || Number.isNaN(price)) {
      send(
        res,
        fail(
          'VALIDATION_ERROR',
          'pauseDays and price query params are required',
          requestId
        )
      );
      return;
    }

    const preview: AdjustmentPreview = this.service.previewAdjustment(
      price,
      billingCycleDays,
      pauseDays,
      currency
    );

    const limitsCheck = this.service.enforceLimits(
      this.service.getRecords(subscriptionId),
      pauseDays,
      this.service.getLimits(),
      subscriptionId
    );

    send(
      res,
      ok(
        {
          subscriptionId,
          ...preview,
          allowed: limitsCheck.allowed,
          limitReason: limitsCheck.reason,
          warning: limitsCheck.warning,
        },
        requestId
      )
    );
  }

  /** GET /subscriptions/:id/pause/history */
  history(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const subscriptionId = req.params.id;

    const records: PauseBillingRecord[] = this.service.getRecords(subscriptionId);
    const adjustments: BillingAdjustment[] =
      this.service.getAdjustments(subscriptionId);

    send(res, ok({ records, adjustments }, requestId));
  }

  /** GET /pause/analytics */
  analytics(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const report: PauseAnalyticsReport = this.service.getAnalytics();
    send(res, ok(report, requestId));
  }

  /** GET /subscriptions/:id/pause/notifications */
  notifications(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const subscriptionId = req.params.id;
    const notifications: PauseNotification[] =
      this.service.getNotifications(subscriptionId);
    send(res, ok(notifications, requestId));
  }

  /** PUT /pause/limits */
  updateLimits(req: Request, res: Response): void {
    const requestId = requestIdFrom(req);
    const body = req.body as Partial<PauseLimits>;

    if (
      body.minDays !== undefined &&
      (typeof body.minDays !== 'number' || body.minDays < 1)
    ) {
      send(res, fail('VALIDATION_ERROR', 'minDays must be a positive number', requestId));
      return;
    }
    if (
      body.maxDays !== undefined &&
      (typeof body.maxDays !== 'number' || body.maxDays < 1)
    ) {
      send(res, fail('VALIDATION_ERROR', 'maxDays must be a positive number', requestId));
      return;
    }
    if (
      body.maxPausesPerYear !== undefined &&
      (typeof body.maxPausesPerYear !== 'number' || body.maxPausesPerYear < 1)
    ) {
      send(
        res,
        fail('VALIDATION_ERROR', 'maxPausesPerYear must be a positive number', requestId)
      );
      return;
    }

    const limits = this.service.setLimits(body);
    send(res, ok(limits, requestId));
  }
}

export const pauseBillingController = new PauseBillingController();
