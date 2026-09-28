import { Router, type Request, type Response, type NextFunction } from 'express';
import { ERROR_HTTP_STATUS_MAP, type ApiResponse } from '../../services/shared/apiResponse';
import {
  createSavedSearch,
  deleteSavedSearch,
  extractRequestId,
  listSavedSearches,
  searchSubscriptions,
  type SubscriptionSearchQueryParams,
  type SubscriptionStatusParam,
} from '../controller';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

function sendResponse(res: Response, response: ApiResponse<unknown>): void {
  if (response.success) {
    res.json(response);
    return;
  }
  res.status(ERROR_HTTP_STATUS_MAP[response.error.code]).json(response);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asCsv(value: unknown): string | undefined {
  const raw = asString(value);
  return raw && raw.includes(',') ? raw : undefined;
}

function subscriptionSearchParams(req: Request): SubscriptionSearchQueryParams {
  return {
    q: asString(req.query.q),
    status: asString(req.query.status) as SubscriptionStatusParam | undefined,
    category: asCsv(req.query.category),
    billingCycle: asCsv(req.query.billingCycle),
    minPrice: asNumber(req.query.minPrice),
    maxPrice: asNumber(req.query.maxPrice),
    dateFrom: asString(req.query.dateFrom),
    dateTo: asString(req.query.dateTo),
    dateField: asString(req.query.dateField) as 'nextBillingDate' | 'createdAt' | undefined,
    isCryptoEnabled: asString(req.query.isCryptoEnabled) as 'true' | 'false' | undefined,
    sort: asString(req.query.sort) as SubscriptionSearchQueryParams['sort'],
    order: asString(req.query.order) as 'asc' | 'desc' | undefined,
    page: asNumber(req.query.page),
    pageSize: asNumber(req.query.pageSize),
  };
}

export function createSearchRouter(): Router {
  const router = Router();

  router.get(
    '/subscriptions',
    asyncHandler(async (req, res) => {
      sendResponse(res, searchSubscriptions(subscriptionSearchParams(req), undefined, extractRequestId(req)));
    }),
  );

  router.get(
    '/saved',
    asyncHandler(async (req, res) => {
      sendResponse(res, listSavedSearches(undefined, extractRequestId(req)));
    }),
  );

  router.post(
    '/saved',
    asyncHandler(async (req, res) => {
      sendResponse(res, createSavedSearch(req.body ?? {}, undefined, extractRequestId(req)));
    }),
  );

  router.delete(
    '/saved/:id',
    asyncHandler(async (req, res) => {
      sendResponse(res, deleteSavedSearch(req.params.id, undefined, extractRequestId(req)));
    }),
  );

  return router;
}