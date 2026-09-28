/**
 * GraphQL resolvers with Relay-compatible cursor-based pagination.
 *
 * Cursor encoding: Base64({ id, sortValue }) so the cursor is opaque to
 * clients but carries enough information for keyset pagination.
 *
 * Edge case: if the cursor row no longer exists the server returns an empty
 * page and advances the cursor — clients can keep paginating.
 *
 * Backward compatibility: legacy subscriptionsOffset resolver remains
 * functional with a deprecation warning in the schema.
 */

import { Pool } from '../shared/db/connectionPool';
import { DataLoaderContext } from './dataloaders';
import { getPlanCacheService } from '../subscription/planCacheRegistry';
import { planMetadataToRow } from '../subscription/domain/PostgresPlanRepository';

// ── Cursor helpers ────────────────────────────────────────────────────────────

interface CursorPayload {
  id: string;
  sortValue: string;
}

function encodeCursor(id: string, sortValue: string): string {
  const payload: CursorPayload = { id, sortValue };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as CursorPayload;
  } catch {
    return null;
  }
}

// ── Relay PageInfo ────────────────────────────────────────────────────────────

interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

function buildPageInfo<T extends { cursor: string }>(
  edges: T[],
  hasNextPage: boolean,
  hasPreviousPage: boolean,
): PageInfo {
  return {
    hasNextPage,
    hasPreviousPage,
    startCursor: edges[0]?.cursor ?? null,
    endCursor: edges[edges.length - 1]?.cursor ?? null,
  };
}

// ── Subscription resolvers ────────────────────────────────────────────────────

async function subscriptionsResolver(
  _parent: unknown,
  args: { userId: string; first?: number; after?: string },
  ctx: { pool: Pool; loaders: DataLoaderContext },
) {
  const first = Math.min(args.first ?? 20, 100);
  const decoded = args.after ? decodeCursor(args.after) : null;

  // Keyset pagination: WHERE created_at < :sortValue OR (created_at = :sortValue AND id > :id)
  let whereSql = 'WHERE s.user_id = $1';
  const params: unknown[] = [args.userId];

  if (decoded) {
    params.push(decoded.sortValue, decoded.id);
    whereSql += ` AND (s.created_at < $${params.length - 1}
                   OR (s.created_at = $${params.length - 1} AND s.id > $${params.length}))`;
  }

  params.push(first + 1);
  const limitParam = params.length;

  const result = await ctx.pool.query<{
    id: string;
    userId: string;
    name: string;
    amount: number;
    currency: string;
    billingCycle: string;
    status: string;
    nextBillingDate: string;
    createdAt: string;
    updatedAt: string;
  }>(
    `SELECT s.id,
            s.user_id           AS "userId",
            s.name,
            s.amount,
            s.currency,
            s.billing_cycle     AS "billingCycle",
            s.status,
            s.next_billing_date AS "nextBillingDate",
            s.created_at        AS "createdAt",
            s.updated_at        AS "updatedAt"
     FROM subscriptions s
     ${whereSql}
     ORDER BY s.created_at DESC, s.id ASC
     LIMIT $${limitParam}`,
    params,
  );

  const hasNextPage = result.rows.length > first;
  const rows = hasNextPage ? result.rows.slice(0, first) : result.rows;

  const countResult = await ctx.pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM subscriptions WHERE user_id = $1`,
    [args.userId],
  );
  const totalCount = parseInt(countResult.rows[0]?.count ?? '0', 10);

  const edges = rows.map((row) => ({
    cursor: encodeCursor(row.id, row.createdAt),
    node: row,
  }));

  return {
    edges,
    pageInfo: buildPageInfo(edges, hasNextPage, decoded !== null),
    totalCount,
  };
}

// ── Transaction resolvers ─────────────────────────────────────────────────────

async function transactionsResolver(
  parent: { id: string } | null,
  args: { subscriptionId?: string; first?: number; after?: string },
  ctx: { pool: Pool; loaders: DataLoaderContext },
) {
  const subscriptionId = parent?.id ?? args.subscriptionId;
  if (!subscriptionId) return { edges: [], pageInfo: buildPageInfo([], false, false), totalCount: 0 };

  const first = Math.min(args.first ?? 20, 100);
  const decoded = args.after ? decodeCursor(args.after) : null;

  let whereSql = 'WHERE t.subscription_id = $1';
  const params: unknown[] = [subscriptionId];

  if (decoded) {
    params.push(decoded.sortValue, decoded.id);
    whereSql += ` AND (t.timestamp < $${params.length - 1}
                   OR (t.timestamp = $${params.length - 1} AND t.id > $${params.length}))`;
  }

  params.push(first + 1);

  const result = await ctx.pool.query<{
    id: string;
    subscriptionId: string;
    userId: string;
    amount: number;
    currency: string;
    status: string;
    timestamp: string;
    txHash: string | null;
  }>(
    `SELECT t.id,
            t.subscription_id AS "subscriptionId",
            t.user_id         AS "userId",
            t.amount,
            t.currency,
            t.status,
            t.timestamp,
            t.tx_hash         AS "txHash"
     FROM transactions t
     ${whereSql}
     ORDER BY t.timestamp DESC, t.id ASC
     LIMIT $${params.length}`,
    params,
  );

  const hasNextPage = result.rows.length > first;
  const rows = hasNextPage ? result.rows.slice(0, first) : result.rows;

  const countResult = await ctx.pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM transactions WHERE subscription_id = $1`,
    [subscriptionId],
  );
  const totalCount = parseInt(countResult.rows[0]?.count ?? '0', 10);

  const edges = rows.map((row) => ({
    cursor: encodeCursor(row.id, row.timestamp),
    node: row,
  }));

  return {
    edges,
    pageInfo: buildPageInfo(edges, hasNextPage, decoded !== null),
    totalCount,
  };
}

// ── Legacy offset resolver ────────────────────────────────────────────────────

async function subscriptionsOffsetResolver(
  _parent: unknown,
  args: { userId: string; limit?: number; offset?: number },
  ctx: { pool: Pool },
) {
  console.warn('[GraphQL] subscriptionsOffset is deprecated — use subscriptions with cursor pagination');
  const limit = Math.min(args.limit ?? 20, 100);
  const offset = args.offset ?? 0;
  const result = await ctx.pool.query(
    `SELECT id, user_id AS "userId", name, amount, currency,
            billing_cycle AS "billingCycle", status,
            next_billing_date AS "nextBillingDate",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM subscriptions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [args.userId, limit, offset],
  );
  return result.rows;
}

// ── Root resolvers map ────────────────────────────────────────────────────────

export const resolvers = {
  Query: {
    subscriptions: subscriptionsResolver,
    subscription: async (
      _parent: unknown,
      args: { id: string },
      ctx: { loaders: DataLoaderContext },
    ) => ctx.loaders.subscriptionLoader.load(args.id),

    transactions: transactionsResolver,

    paymentMethods: async (
      _parent: unknown,
      args: { userId: string; first?: number; after?: string },
      ctx: { pool: Pool },
    ) => {
      const first = Math.min(args.first ?? 10, 100);
      const decoded = args.after ? decodeCursor(args.after) : null;
      let whereSql = 'WHERE user_id = $1';
      const params: unknown[] = [args.userId];

      if (decoded) {
        params.push(decoded.id);
        whereSql += ` AND id > $${params.length}`;
      }

      params.push(first + 1);
      const result = await ctx.pool.query(
        `SELECT id, user_id AS "userId", type, last4, brand, expires_at AS "expiresAt"
         FROM payment_methods ${whereSql} ORDER BY id LIMIT $${params.length}`,
        params,
      );

      const hasNextPage = result.rows.length > first;
      const rows = hasNextPage ? result.rows.slice(0, first) : result.rows;
      const edges = rows.map((row) => ({ cursor: encodeCursor(String(row.id), String(row.id)), node: row }));
      return { edges, pageInfo: buildPageInfo(edges, hasNextPage, decoded !== null) };
    },

    plans: async (
      _parent: unknown,
      args: { first?: number; after?: string },
      ctx: { pool: Pool },
    ) => {
      const first = Math.min(args.first ?? 50, 100);
      const decoded = args.after ? decodeCursor(args.after) : null;
      const planCache = getPlanCacheService();

      if (planCache) {
        let rows = (await planCache.getActivePlans()).map(planMetadataToRow);
        if (decoded) {
          const idx = rows.findIndex((r) => r.id > decoded.id);
          rows = idx >= 0 ? rows.slice(idx) : [];
        }
        const hasNextPage = rows.length > first;
        const page = hasNextPage ? rows.slice(0, first) : rows;
        const edges = page.map((row) => ({
          cursor: encodeCursor(String(row.id), String(row.id)),
          node: row,
        }));
        return { edges, pageInfo: buildPageInfo(edges, hasNextPage, decoded !== null) };
      }

      let whereSql = '';
      const params: unknown[] = [];

      if (decoded) {
        params.push(decoded.id);
        whereSql = `WHERE id > $${params.length}`;
      }

      params.push(first + 1);
      const result = await ctx.pool.query(
        `SELECT id, name, price, currency, billing_cycle AS "billingCycle"
         FROM plans ${whereSql} ORDER BY id LIMIT $${params.length}`,
        params,
      );

      const hasNextPage = result.rows.length > first;
      const rows = hasNextPage ? result.rows.slice(0, first) : result.rows;
      const edges = rows.map((row) => ({ cursor: encodeCursor(String(row.id), String(row.id)), node: row }));
      return { edges, pageInfo: buildPageInfo(edges, hasNextPage, decoded !== null) };
    },

    subscriptionReport: async (
      _parent: unknown,
      args: { userId?: string; startDate?: string; endDate?: string },
      ctx: { pool?: Pool },
    ) => {
      const startDate = args.startDate || new Date(Date.now() - 30 * 86400 * 1000).toISOString();
      const endDate = args.endDate || new Date().toISOString();
      const userId = args.userId;

      let subscriptions: Array<{
        id: string;
        userId: string;
        name: string;
        amount: number;
        currency: string;
        billingCycle: string;
        status: string;
      }> = [];

      if (ctx.pool && typeof ctx.pool.query === 'function') {
        try {
          let sql = 'SELECT id, user_id AS "userId", name, amount, currency, billing_cycle AS "billingCycle", status FROM subscriptions';
          const params: any[] = [];
          if (userId) {
            params.push(userId);
            sql += ` WHERE user_id = $${params.length}`;
          }
          const res = await ctx.pool.query(sql, params);
          subscriptions = res.rows || [];
        } catch {
          subscriptions = [];
        }
      }

      let totalActive = 0;
      let totalCanceled = 0;
      let totalTrial = 0;
      let totalPastDue = 0;
      let mrr = 0;

      const statusMap: Record<string, { count: number; revenue: number }> = {};
      const planMap: Record<string, { name: string; activeCount: number; mrr: number }> = {};

      for (const sub of subscriptions) {
        const amount = Number(sub.amount) || 0;
        const isMonthly = sub.billingCycle === 'annual' || sub.billingCycle === 'yearly' ? amount / 12 : amount;
        const status = sub.status || 'active';

        if (!statusMap[status]) {
          statusMap[status] = { count: 0, revenue: 0 };
        }
        statusMap[status].count += 1;
        statusMap[status].revenue += isMonthly;

        const planKey = sub.name || 'Default Plan';
        if (!planMap[planKey]) {
          planMap[planKey] = { name: planKey, activeCount: 0, mrr: 0 };
        }

        if (status === 'active') {
          totalActive += 1;
          mrr += isMonthly;
          planMap[planKey].activeCount += 1;
          planMap[planKey].mrr += isMonthly;
        } else if (status === 'canceled' || status === 'cancelled') {
          totalCanceled += 1;
        } else if (status === 'trial') {
          totalTrial += 1;
        } else if (status === 'past_due') {
          totalPastDue += 1;
        }
      }

      const arr = mrr * 12;
      const totalCount = subscriptions.length || (totalActive + totalCanceled);
      const churnRate = totalCount > 0 ? Number(((totalCanceled / totalCount) * 100).toFixed(2)) : 0;
      const arpu = totalActive > 0 ? Number((mrr / totalActive).toFixed(2)) : 0;

      const breakdownByStatus = Object.entries(statusMap).map(([status, val]) => ({
        status,
        count: val.count,
        revenue: Number(val.revenue.toFixed(2)),
      }));

      const breakdownByPlan = Object.entries(planMap).map(([planId, val]) => ({
        planId,
        planName: val.name,
        activeSubscriptions: val.activeCount,
        monthlyRevenue: Number(val.mrr.toFixed(2)),
      }));

      return {
        totalActiveSubscriptions: totalActive,
        totalCanceledSubscriptions: totalCanceled,
        totalTrialSubscriptions: totalTrial,
        totalPastDueSubscriptions: totalPastDue,
        monthlyRecurringRevenue: Number(mrr.toFixed(2)),
        annualRecurringRevenue: Number(arr.toFixed(2)),
        churnRate,
        averageRevenuePerUser: arpu,
        currency: subscriptions[0]?.currency || 'USD',
        periodStart: startDate,
        periodEnd: endDate,
        breakdownByStatus,
        breakdownByPlan,
      };
    },

    subscriptionAnalytics: async (
      _parent: unknown,
      args: { userId?: string; period?: string },
      ctx: { pool?: Pool },
    ) => {
      const days = args.period === '7d' ? 7 : args.period === '90d' ? 90 : 30;
      const startDate = new Date(Date.now() - days * 86400 * 1000).toISOString();
      const endDate = new Date().toISOString();

      // Delegate to subscriptionReport resolver logic
      const resolver = (resolvers.Query as any).subscriptionReport;
      return resolver(_parent, { userId: args.userId, startDate, endDate }, ctx);
    },

    subscriptionsOffset: subscriptionsOffsetResolver,
  },

  Subscription: {
    transactions: transactionsResolver,
  },
};
