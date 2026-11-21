/**
 * Keyset-paginated admin list routes (Issue #2079).
 *
 * The former offset-based admin lists scanned an ever-growing number of rows
 * and could duplicate/omit records when data changed between page requests.
 * Every heavy list now goes through `(created_at, id)` cursors from
 * `../utils/pagination`, with a fixed page-size ceiling and no COUNT query.
 *
 * The route layer is framework-agnostic: it only needs `{ params, query }` on
 * the request and `status().json()` on the response, which Express satisfies.
 */

import { buildErrorEnvelope } from '../middleware/errorEnvelope';
import {
  createKeysetPage,
  parsePageRequest,
  type KeysetPage,
  type PageRequest,
  type PaginationError,
} from '../utils/pagination';

export const ADMIN_RESOURCES = ['users', 'subscriptions', 'transactions', 'audit-events'] as const;
export type AdminResource = (typeof ADMIN_RESOURCES)[number];

export interface AdminListRow {
  id: string;
  createdAt: string;
  [field: string]: unknown;
}

export interface AdminFetchQuery extends PageRequest {
  /** `limit + 1`; fetch this many rows so the page can report hasMore. */
  fetchLimit: number;
}

export type AdminListFetcher = (
  query: AdminFetchQuery,
  context: { resource: AdminResource },
) => Promise<readonly AdminListRow[]>;

export interface AdminRouteLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface AdminListMetricsEvent {
  /** Raw resource name, preserved so unsupported values are visible in metrics. */
  resource: string;
  outcome: 'success' | 'invalid_cursor' | 'invalid_pagination' | 'unsupported_resource' | 'error';
  direction: PageRequest['direction'];
  limit: number;
  durationMs: number;
  itemCount?: number;
  hasMore?: boolean;
}

export interface AdminRouteDeps {
  lists: Record<AdminResource, AdminListFetcher>;
  logger?: AdminRouteLogger;
  onMetrics?: (event: AdminListMetricsEvent) => void;
  now?: () => number;
}

export interface AdminRequest {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

export interface AdminResponse {
  status(code: number): AdminResponse;
  json(body: unknown): void;
  setHeader?(name: string, value: string): void;
}

export type AdminListHandler = (req: AdminRequest, res: AdminResponse) => Promise<void>;

export interface AdminRouter {
  get(path: string, handler: AdminListHandler): void;
}

function isAdminResource(value: string): value is AdminResource {
  return (ADMIN_RESOURCES as readonly string[]).includes(value);
}

function sendErrorResponse(
  res: AdminResponse,
  status: number,
  code: string,
  message: string,
): void {
  res.status(status).json(buildErrorEnvelope(status, message, { code }));
}

/**
 * Build the shared GET /admin/:resource handler. Validation and telemetry are
 * emitted before the fetcher runs so bad cursors never reach the database.
 */
export function createAdminListHandler(deps: AdminRouteDeps): AdminListHandler {
  const startedAt = deps.now ?? Date.now;
  const noopLogger: AdminRouteLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  const logger = deps.logger ?? noopLogger;

  return async (req, res) => {
    const begin = startedAt();
    const rawResource = req.params?.resource ?? req.query?.resource;
    const resource = typeof rawResource === 'string' ? rawResource.trim().toLowerCase() : '';
    const emit = (event: Omit<AdminListMetricsEvent, 'durationMs'>): void => {
      deps.onMetrics?.({ ...event, durationMs: Math.max(0, startedAt() - begin) });
    };

    if (!isAdminResource(resource)) {
      logger.warn('[admin] unsupported list resource', { resource });
      emit({ resource, outcome: 'unsupported_resource', direction: 'forward', limit: 0 });
      sendErrorResponse(res, 400, 'UNSUPPORTED_RESOURCE', `Unsupported admin list: ${resource || '(missing)'}`);
      return;
    }

    let pageRequest: PageRequest;
    try {
      pageRequest = parsePageRequest<AdminListRow>(req.query ?? {}, {
        onValidationError: (error: PaginationError) => {
          logger.warn('[admin] invalid pagination request', {
            resource,
            code: error.code,
            reason: error.message,
          });
          emit({
            resource,
            outcome: error.code === 'INVALID_CURSOR' ? 'invalid_cursor' : 'invalid_pagination',
            direction: 'forward',
            limit: 0,
          });
        },
      });
    } catch (error) {
      const paginationError = error as PaginationError;
      sendErrorResponse(res, 400, paginationError.code ?? 'INVALID_PAGINATION', paginationError.message);
      return;
    }

    try {
      const fetchQuery: AdminFetchQuery = {
        ...pageRequest,
        fetchLimit: pageRequest.limit + 1,
      };
      const rows = await deps.lists[resource](fetchQuery, { resource });
      const page: KeysetPage<AdminListRow> = createKeysetPage(rows, pageRequest);

      logger.info('[admin] list page served', {
        resource,
        direction: pageRequest.direction,
        limit: pageRequest.limit,
        itemCount: page.items.length,
        hasMore: page.pageInfo.hasNextPage || page.pageInfo.hasPreviousPage,
      });
      emit({
        resource,
        outcome: 'success',
        direction: pageRequest.direction,
        limit: pageRequest.limit,
        itemCount: page.items.length,
        hasMore: page.pageInfo.hasNextPage || page.pageInfo.hasPreviousPage,
      });

      res.status(200).json({
        success: true,
        data: {
          resource,
          items: page.items,
          pageInfo: page.pageInfo,
          nextCursor: page.nextCursor,
          prevCursor: page.prevCursor,
        },
      });
    } catch (error) {
      logger.error('[admin] list fetch failed', {
        resource,
        error: error instanceof Error ? error.message : String(error),
      });
      emit({
        resource,
        outcome: 'error',
        direction: pageRequest.direction,
        limit: pageRequest.limit,
      });
      sendErrorResponse(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
    }
  };
}

/** Register all heavy admin lists on an Express-compatible router. */
export function registerAdminRoutes(router: AdminRouter, deps: AdminRouteDeps): void {
  const handler = createAdminListHandler(deps);
  router.get('/admin/:resource', handler);
}

export { encodeCursor, decodeCursor } from '../utils/pagination';
