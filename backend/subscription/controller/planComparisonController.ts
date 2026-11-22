/**
 * Issue #776 – Plan comparison / recommendation API controller.
 */

import type { Request, Response } from 'express';
import { ok, fail } from '../../services/shared/apiResponse';
import { extractRequestId } from './index';
import type {
  ComparablePlan,
  CompareOptions,
  PreferenceProfile,
  RecommendationTrackingEvent,
} from '../../../src/types/planComparison';
import {
  PlanRecommendationTracker,
  compareAndTrack,
  recommendAndTrack,
  createComparisonShare,
  resolveComparisonShare,
  trackRecommendationEvent,
  getComparisonAnalytics,
} from '../../../src/services/planComparisonEngine';

/** Process-local tracker shared by all plan-comparison endpoints. */
export const planComparisonTracker = new PlanRecommendationTracker();

function requestId(req: Request): string | undefined {
  return extractRequestId(req);
}

export function comparePlansHandler(req: Request, res: Response): void {
  const plans = req.body?.plans as ComparablePlan[] | undefined;
  const options = req.body?.options as CompareOptions | undefined;

  if (!Array.isArray(plans) || plans.length < 2) {
    res
      .status(400)
      .json(fail('BAD_REQUEST', 'Body must include at least two plans', requestId(req)));
    return;
  }

  try {
    const result = compareAndTrack(plans, options, planComparisonTracker);
    res.status(200).json(ok(result, requestId(req)));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Comparison failed';
    res.status(400).json(fail('BAD_REQUEST', message, requestId(req)));
  }
}

export function recommendPlansHandler(req: Request, res: Response): void {
  const plans = req.body?.plans as ComparablePlan[] | undefined;
  const profile = (req.body?.profile ?? {}) as PreferenceProfile;

  if (!Array.isArray(plans) || plans.length === 0) {
    res
      .status(400)
      .json(fail('BAD_REQUEST', 'Body must include at least one plan', requestId(req)));
    return;
  }

  try {
    const recommendations = recommendAndTrack(plans, profile, planComparisonTracker);
    res.status(200).json(ok({ recommendations }, requestId(req)));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Recommendation failed';
    res.status(400).json(fail('BAD_REQUEST', message, requestId(req)));
  }
}

export function trackRecommendationHandler(req: Request, res: Response): void {
  const body = req.body as Partial<RecommendationTrackingEvent> | undefined;

  if (!body?.recommendationId || !body?.planId || !body?.eventType) {
    res
      .status(400)
      .json(
        fail(
          'BAD_REQUEST',
          'Body must include recommendationId, planId, and eventType',
          requestId(req)
        )
      );
    return;
  }

  const event = trackRecommendationEvent(
    {
      recommendationId: body.recommendationId,
      planId: body.planId,
      eventType: body.eventType,
      userId: body.userId,
      comparisonId: body.comparisonId,
      metadata: body.metadata,
      occurredAt: body.occurredAt,
    },
    planComparisonTracker
  );

  res.status(200).json(ok(event, requestId(req)));
}

export function getAnalyticsHandler(req: Request, res: Response): void {
  const analytics = getComparisonAnalytics(planComparisonTracker);
  res.status(200).json(ok(analytics, requestId(req)));
}

export function shareComparisonHandler(req: Request, res: Response): void {
  const comparisonId = req.body?.comparisonId as string | undefined;
  const planIds = req.body?.planIds as string[] | undefined;
  const ttlMs = req.body?.ttlMs as number | undefined;
  const payload = req.body?.payload;

  if (!comparisonId || !Array.isArray(planIds) || planIds.length < 2) {
    res
      .status(400)
      .json(
        fail(
          'BAD_REQUEST',
          'Body must include comparisonId and at least two planIds',
          requestId(req)
        )
      );
    return;
  }

  const share = createComparisonShare(
    comparisonId,
    planIds,
    payload,
    ttlMs,
    planComparisonTracker
  );

  res.status(201).json(ok(share, requestId(req)));
}

export function resolveShareHandler(req: Request, res: Response): void {
  const token = req.params.token;
  if (!token) {
    res.status(400).json(fail('BAD_REQUEST', 'Share token is required', requestId(req)));
    return;
  }

  const share = resolveComparisonShare(token, planComparisonTracker);
  if (!share) {
    res
      .status(404)
      .json(fail('NOT_FOUND', `Share token "${token}" not found or expired`, requestId(req)));
    return;
  }

  res.status(200).json(ok(share, requestId(req)));
}
