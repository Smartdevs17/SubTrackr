/**
 * Fraud Investigation REST API (framework-agnostic handler functions)
 *
 * Endpoints:
 *   GET    /fraud/investigations              – list cases with optional filters
 *   GET    /fraud/investigations/:caseId      – get single case
 *   POST   /fraud/investigations              – open a case manually
 *   PATCH  /fraud/investigations/:caseId      – update case (assign, resolve, escalate, dismiss)
 *   GET    /fraud/investigations/:caseId/notes – list notes for case
 *   POST   /fraud/investigations/:caseId/notes – add a note to case
 *   GET    /fraud/investigations/stats         – aggregate statistics
 *
 *   POST   /fraud/report                       – generate full fraud report for a merchant
 */

import { fraudInvestigationService, InvestigationFilter } from '../domain/FraudInvestigationService';
import { FraudReviewOutcome, FraudReviewStatus } from '../../../src/types/fraud';

// ── Response helpers ──────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { success: true, data };
}

function err(message: string, status = 400) {
  return { success: false, error: { message }, status };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/** GET /fraud/investigations */
export function listCases(params: {
  status?: string;
  merchantId?: string;
  subscriberId?: string;
  minRiskScore?: string;
  limit?: string;
  offset?: string;
}) {
  const filter: InvestigationFilter = {};

  if (params.status) {
    const validStatuses: FraudReviewStatus[] = ['pending', 'reviewed', 'dismissed', 'escalated'];
    if (!validStatuses.includes(params.status as FraudReviewStatus)) {
      return err(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }
    filter.status = params.status as FraudReviewStatus;
  }

  if (params.merchantId) filter.merchantId = params.merchantId;
  if (params.subscriberId) filter.subscriberId = params.subscriberId;

  if (params.minRiskScore) {
    const score = parseInt(params.minRiskScore, 10);
    if (Number.isNaN(score) || score < 0 || score > 100) {
      return err('minRiskScore must be a number between 0 and 100');
    }
    filter.minRiskScore = score;
  }

  if (params.limit) {
    const limit = parseInt(params.limit, 10);
    if (Number.isNaN(limit) || limit < 1 || limit > 200) {
      return err('limit must be a number between 1 and 200');
    }
    filter.limit = limit;
  }

  if (params.offset) {
    const offset = parseInt(params.offset, 10);
    if (Number.isNaN(offset) || offset < 0) {
      return err('offset must be a non-negative number');
    }
    filter.offset = offset;
  }

  return ok(fraudInvestigationService.getCases(filter));
}

/** GET /fraud/investigations/:caseId */
export function getCase(caseId: string) {
  const fraudCase = fraudInvestigationService.getCase(caseId);
  if (!fraudCase) return err(`Case ${caseId} not found`, 404);
  return ok(fraudCase);
}

/** POST /fraud/investigations */
export function createCase(body: {
  subscriptionId?: string;
  subscriberId?: string;
  merchantId?: string;
  merchantName?: string;
  subscriptionName?: string;
  riskScore?: number;
  reason?: string;
}) {
  if (!body.subscriptionId) return err('subscriptionId is required');
  if (!body.subscriberId) return err('subscriberId is required');
  if (!body.merchantId) return err('merchantId is required');
  if (!body.merchantName) return err('merchantName is required');
  if (!body.subscriptionName) return err('subscriptionName is required');
  if (body.riskScore === undefined || body.riskScore === null) {
    return err('riskScore is required');
  }
  if (body.riskScore < 0 || body.riskScore > 100) {
    return err('riskScore must be between 0 and 100');
  }
  if (!body.reason) return err('reason is required');

  const fraudCase = fraudInvestigationService.createCase({
    subscriptionId: body.subscriptionId,
    subscriberId: body.subscriberId,
    merchantId: body.merchantId,
    merchantName: body.merchantName,
    subscriptionName: body.subscriptionName,
    riskScore: body.riskScore,
    reason: body.reason,
  });

  return ok(fraudCase);
}

/** PATCH /fraud/investigations/:caseId */
export function updateCase(
  caseId: string,
  body: {
    action?: 'assign' | 'resolve' | 'escalate' | 'dismiss' | 'start_review';
    reviewer?: string;
    outcome?: string;
    notes?: string;
  },
) {
  if (!body.action) return err('action is required');

  switch (body.action) {
    case 'assign': {
      if (!body.reviewer) return err('reviewer is required for assign action');
      const result = fraudInvestigationService.assignReviewer(caseId, body.reviewer);
      return result.success ? ok(result.case) : err(result.error ?? 'Unknown error', 404);
    }

    case 'start_review': {
      if (!body.reviewer) return err('reviewer is required for start_review action');
      const result = fraudInvestigationService.startReview(caseId, body.reviewer);
      return result.success ? ok(result.case) : err(result.error ?? 'Unknown error', 404);
    }

    case 'resolve': {
      const validOutcomes: FraudReviewOutcome[] = ['true_positive', 'false_positive', 'needs_follow_up'];
      if (!body.outcome || !validOutcomes.includes(body.outcome as FraudReviewOutcome)) {
        return err(`outcome must be one of: ${validOutcomes.join(', ')}`);
      }
      const result = fraudInvestigationService.resolveCase(
        caseId,
        body.outcome as FraudReviewOutcome,
        body.notes,
      );
      return result.success ? ok(result.case) : err(result.error ?? 'Unknown error', 404);
    }

    case 'escalate': {
      const result = fraudInvestigationService.escalateCase(caseId, body.notes);
      return result.success ? ok(result.case) : err(result.error ?? 'Unknown error', 404);
    }

    case 'dismiss': {
      const result = fraudInvestigationService.dismissCase(caseId, body.notes);
      return result.success ? ok(result.case) : err(result.error ?? 'Unknown error', 404);
    }

    default:
      return err(`Unknown action: ${body.action as string}`);
  }
}

/** GET /fraud/investigations/:caseId/notes */
export function getCaseNotes(caseId: string) {
  const fraudCase = fraudInvestigationService.getCase(caseId);
  if (!fraudCase) return err(`Case ${caseId} not found`, 404);
  return ok(fraudInvestigationService.getNotes(caseId));
}

/** POST /fraud/investigations/:caseId/notes */
export function addCaseNote(caseId: string, body: { author?: string; content?: string }) {
  if (!body.author) return err('author is required');
  if (!body.content || body.content.trim() === '') return err('content is required');

  const note = fraudInvestigationService.addNote(caseId, body.author, body.content);
  if (!note) return err(`Case ${caseId} not found`, 404);
  return ok(note);
}

/** GET /fraud/investigations/stats */
export function getInvestigationStats() {
  return ok(fraudInvestigationService.getStats());
}
