/**
 * Progressive dunning escalation API handlers.
 *
 * Endpoints (mounted under /dunning via dunningEscalationRouter):
 *   PUT  /policies/:planId
 *   GET  /policies/:planId
 *   POST /:subscriptionId/evaluate
 *   POST /process-due
 *   GET  /analytics
 *   GET  /optimize/:planId
 *   GET  /templates
 */

import type { Request, Response } from 'express';
import { ok, fail, ERROR_HTTP_STATUS_MAP } from '../../services/shared/apiResponse';
import type { EscalationPolicy } from '../../../src/types/dunningEscalation';
import type { DunningEntry } from '../../../src/types/dunning';
import {
  ProgressiveDunningEngine,
  progressiveDunningEngine,
} from '../../../src/services/progressiveDunningEngine';
import { dunningService } from '../../services/billing/dunningService';

function requestId(req: Request): string | undefined {
  return (req.headers['x-request-id'] as string) || undefined;
}

function sendFail(
  res: Response,
  code: Parameters<typeof fail>[0],
  message: string,
  req: Request,
): void {
  res.status(ERROR_HTTP_STATUS_MAP[code] ?? 400).json(fail(code, message, requestId(req)));
}

export function createDunningEscalationController(
  engine: ProgressiveDunningEngine = progressiveDunningEngine,
) {
  return {
    /** PUT /dunning/policies/:planId */
    putPolicy(req: Request, res: Response): void {
      const planId = req.params.planId;
      if (!planId) {
        sendFail(res, 'VALIDATION_ERROR', 'planId is required', req);
        return;
      }

      const body = (req.body ?? {}) as Partial<EscalationPolicy>;
      if (!Array.isArray(body.rules)) {
        sendFail(res, 'VALIDATION_ERROR', 'rules array is required', req);
        return;
      }

      const policy = engine.configurePolicy({
        planId,
        rules: body.rules,
        enabled: body.enabled ?? true,
        maxEscalations: body.maxEscalations ?? 3,
      });

      res.status(200).json(ok(policy, requestId(req)));
    },

    /** GET /dunning/policies/:planId */
    getPolicy(req: Request, res: Response): void {
      const planId = req.params.planId;
      const policy = engine.getPolicy(planId);
      if (!policy) {
        sendFail(res, 'NOT_FOUND', `No escalation policy for plan "${planId}"`, req);
        return;
      }
      res.status(200).json(ok(policy, requestId(req)));
    },

    /** POST /dunning/:subscriptionId/evaluate */
    evaluate(req: Request, res: Response): void {
      const subscriptionId = req.params.subscriptionId;
      let entry = dunningService.getDunningEntry(subscriptionId);

      // Allow callers to pass a full entry body for dry-run evaluation.
      if (!entry && req.body?.entry) {
        entry = req.body.entry as DunningEntry;
      }

      if (!entry) {
        sendFail(
          res,
          'DUNNING_ENTRY_NOT_FOUND',
          `No dunning entry for subscription "${subscriptionId}"`,
          req,
        );
        return;
      }

      const now =
        typeof req.body?.now === 'number' ? (req.body.now as number) : Date.now();
      const nextStage = engine.evaluateEscalation(entry, now);
      const rule = engine.findMatchingRule(entry, now);

      res.status(200).json(
        ok(
          {
            subscriptionId,
            currentStage: entry.currentStage,
            nextStage,
            matchingRuleId: rule?.id ?? null,
            shouldEscalate: nextStage !== null,
          },
          requestId(req),
        ),
      );
    },

    /** POST /dunning/process-due */
    processDue(req: Request, res: Response): void {
      const now =
        typeof req.body?.now === 'number' ? (req.body.now as number) : Date.now();

      let entries: DunningEntry[] = dunningService.listActiveDunning();
      if (Array.isArray(req.body?.entries)) {
        entries = req.body.entries as DunningEntry[];
      }

      const result = engine.processDueEscalations(entries, now);

      // Persist escalated entries back into DunningService when they exist there.
      for (const { entry } of result.processed) {
        if (dunningService.getDunningEntry(entry.subscriptionId)) {
          dunningService.overrideStage(entry.subscriptionId, entry.currentStage);
        }
      }

      res.status(200).json(
        ok(
          {
            escalated: result.processed.length,
            skipped: result.skipped.length,
            results: result.processed.map(({ entry, event }) => ({ entry, event })),
          },
          requestId(req),
        ),
      );
    },

    /** GET /dunning/analytics */
    getAnalytics(req: Request, res: Response): void {
      res.status(200).json(ok(engine.getAnalytics(), requestId(req)));
    },

    /** GET /dunning/optimize/:planId */
    optimize(req: Request, res: Response): void {
      const planId = req.params.planId;
      const suggestions = engine.optimizePolicy(planId);
      res.status(200).json(ok({ planId, suggestions }, requestId(req)));
    },

    /** GET /dunning/templates */
    getTemplates(req: Request, res: Response): void {
      res.status(200).json(ok(engine.listTemplates(), requestId(req)));
    },
  };
}

export const dunningEscalationController = createDunningEscalationController();
