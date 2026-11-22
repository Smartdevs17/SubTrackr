import { Router, type NextFunction, type Request, type Response } from 'express';
import { ERROR_HTTP_STATUS_MAP, fail, ok } from '../shared/apiResponse';
import {
  TrialOptimizationService,
  trialOptimizationService,
} from './trialOptimizationService';

function requestId(req: Request): string | undefined {
  return typeof req.headers['x-request-id'] === 'string'
    ? req.headers['x-request-id']
    : undefined;
}

function sendError(res: Response, code: 'NOT_FOUND' | 'VALIDATION_ERROR', message: string, id?: string): void {
  res.status(ERROR_HTTP_STATUS_MAP[code]).json(fail(code, message, id));
}

export class TrialOptimizationController {
  constructor(private readonly service: TrialOptimizationService = trialOptimizationService) {}

  getRecommendations(req: Request, res: Response): void {
    res.json(ok(this.service.evaluateAllTrials(), requestId(req)));
  }

  getRecommendation(req: Request, res: Response): void {
    const recommendation = this.service.evaluateTrial(req.params.trialId);
    if (!recommendation) {
      sendError(res, 'NOT_FOUND', `Trial ${req.params.trialId} was not found`, requestId(req));
      return;
    }
    res.json(ok(recommendation, requestId(req)));
  }

  runExpirationWorkflow(req: Request, res: Response): void {
    const reference = typeof req.body?.referenceDate === 'string' ? new Date(req.body.referenceDate) : new Date();
    if (Number.isNaN(reference.getTime())) {
      sendError(res, 'VALIDATION_ERROR', 'referenceDate must be a valid ISO date', requestId(req));
      return;
    }
    res.json(ok(this.service.runExpirationWorkflow(reference), requestId(req)));
  }

  getFunnel(req: Request, res: Response): void {
    const planId = typeof req.query.planId === 'string' ? req.query.planId : undefined;
    res.json(ok(this.service.getFunnelMetrics(planId), requestId(req)));
  }

  getReminders(req: Request, res: Response): void {
    res.json(ok(this.service.getPendingReminders(), requestId(req)));
  }
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => void;

function wrap(handler: (req: Request, res: Response) => void): AsyncHandler {
  return (req, res, next) => {
    try {
      handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

export function createTrialOptimizationRouter(
  controller: TrialOptimizationController = new TrialOptimizationController(),
): Router {
  const router = Router();

  router.get('/recommendations', wrap((req, res) => controller.getRecommendations(req, res)));
  router.get('/recommendations/:trialId', wrap((req, res) => controller.getRecommendation(req, res)));
  router.post('/expirations/run', wrap((req, res) => controller.runExpirationWorkflow(req, res)));
  router.get('/funnel', wrap((req, res) => controller.getFunnel(req, res)));
  router.get('/reminders', wrap((req, res) => controller.getReminders(req, res)));

  return router;
}

export default createTrialOptimizationRouter;
