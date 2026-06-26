/**
 * Query Routing Middleware
 *
 * Routes read queries to the appropriate materialized view and write
 * operations to the normalised base tables.  Acts as a transparent layer
 * so callers don't need to know which view serves their query.
 *
 * Usage:
 *   const router = new QueryRouter(pool);
 *   const summary = await router.getActiveSubscriptionSummary(userId);
 *   const balance  = await router.getSubscriberBalance(userId);
 *
 * Write operations bypass views and go directly to the base tables.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QueryClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

// ── View freshness ────────────────────────────────────────────────────────────

export interface ViewFreshness {
  viewName: string;
  refreshedAt: Date | null;
  lagMs: number;
  isStale: boolean;
}

const STALE_THRESHOLD_MS = 60_000; // 1 minute

// ── Typed result shapes ───────────────────────────────────────────────────────

export interface ActiveSubscriptionSummary {
  userId: string;
  activeCount: number;
  totalMonthlyAmount: number;
  earliestBillingDate: Date | null;
  lastUpdatedAt: Date | null;
  refreshedAt: Date;
}

export interface SubscriberBalance {
  userId: string;
  totalTransactions: number;
  totalCharged: number;
  totalFailed: number;
  lastTransactionAt: Date | null;
  refreshedAt: Date;
}

export interface MonthlyRevenue {
  month: Date;
  currency: string;
  subscriptionCount: number;
  transactionCount: number;
  grossRevenue: number;
  failedAmount: number;
  refreshedAt: Date;
}

export interface ChurnSummary {
  cohortMonth: Date;
  cohortSize: number;
  cancelledCount: number;
  churnRatePct: number;
  refreshedAt: Date;
}

// ── Router ────────────────────────────────────────────────────────────────────

export class QueryRouter {
  private db: QueryClient;

  constructor(db: QueryClient) {
    this.db = db;
  }

  // ── Read from materialized views ──────────────────────────────────────────

  async getActiveSubscriptionSummary(userId: string): Promise<ActiveSubscriptionSummary | null> {
    const result = await this.db.query<ActiveSubscriptionSummary>(
      `SELECT
         user_id           AS "userId",
         active_count      AS "activeCount",
         total_monthly_amount AS "totalMonthlyAmount",
         earliest_billing_date AS "earliestBillingDate",
         last_updated_at   AS "lastUpdatedAt",
         refreshed_at      AS "refreshedAt"
       FROM active_subscriptions_summary
       WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async getSubscriberBalance(userId: string): Promise<SubscriberBalance | null> {
    const result = await this.db.query<SubscriberBalance>(
      `SELECT
         user_id              AS "userId",
         total_transactions   AS "totalTransactions",
         total_charged        AS "totalCharged",
         total_failed         AS "totalFailed",
         last_transaction_at  AS "lastTransactionAt",
         refreshed_at         AS "refreshedAt"
       FROM subscriber_balance_mv
       WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  async getMonthlyRevenue(
    currency: string,
    fromMonth?: Date,
    toMonth?: Date,
  ): Promise<MonthlyRevenue[]> {
    let sql = `
      SELECT
        month,
        currency,
        subscription_count  AS "subscriptionCount",
        transaction_count   AS "transactionCount",
        gross_revenue       AS "grossRevenue",
        failed_amount       AS "failedAmount",
        refreshed_at        AS "refreshedAt"
      FROM monthly_revenue_mv
      WHERE currency = $1
    `;
    const params: unknown[] = [currency];

    if (fromMonth) {
      params.push(fromMonth);
      sql += ` AND month >= $${params.length}`;
    }
    if (toMonth) {
      params.push(toMonth);
      sql += ` AND month <= $${params.length}`;
    }

    sql += ' ORDER BY month DESC';
    const result = await this.db.query<MonthlyRevenue>(sql, params);
    return result.rows;
  }

  async getChurnSummary(fromMonth?: Date): Promise<ChurnSummary[]> {
    let sql = `
      SELECT
        cohort_month    AS "cohortMonth",
        cohort_size     AS "cohortSize",
        cancelled_count AS "cancelledCount",
        churn_rate_pct  AS "churnRatePct",
        refreshed_at    AS "refreshedAt"
      FROM churn_summary_mv
    `;
    const params: unknown[] = [];

    if (fromMonth) {
      params.push(fromMonth);
      sql += ` WHERE cohort_month >= $1`;
    }

    sql += ' ORDER BY cohort_month DESC';
    const result = await this.db.query<ChurnSummary>(sql, params);
    return result.rows;
  }

  // ── Freshness checks ──────────────────────────────────────────────────────

  async getViewFreshness(): Promise<ViewFreshness[]> {
    const viewNames = [
      'active_subscriptions_summary',
      'subscriber_balance_mv',
      'monthly_revenue_mv',
      'churn_summary_mv',
    ];

    const results: ViewFreshness[] = [];

    for (const viewName of viewNames) {
      try {
        const result = await this.db.query<{ refreshed_at: Date }>(
          `SELECT MAX(refreshed_at) AS refreshed_at FROM ${viewName}`,
        );
        const refreshedAt = result.rows[0]?.refreshed_at ?? null;
        const lagMs = refreshedAt ? Date.now() - new Date(refreshedAt).getTime() : Infinity;

        results.push({
          viewName,
          refreshedAt,
          lagMs,
          isStale: lagMs > STALE_THRESHOLD_MS,
        });
      } catch {
        results.push({
          viewName,
          refreshedAt: null,
          lagMs: Infinity,
          isStale: true,
        });
      }
    }

    return results;
  }

  // ── Write directly to base tables ─────────────────────────────────────────

  async upsertSubscription(subscription: {
    id: string;
    userId: string;
    name: string;
    amount: number;
    currency: string;
    billingCycle: string;
    status: string;
    nextBillingDate: Date;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO subscriptions
         (id, user_id, name, amount, currency, billing_cycle, status, next_billing_date, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         name             = EXCLUDED.name,
         amount           = EXCLUDED.amount,
         currency         = EXCLUDED.currency,
         billing_cycle    = EXCLUDED.billing_cycle,
         status           = EXCLUDED.status,
         next_billing_date = EXCLUDED.next_billing_date,
         updated_at       = NOW()`,
      [
        subscription.id,
        subscription.userId,
        subscription.name,
        subscription.amount,
        subscription.currency,
        subscription.billingCycle,
        subscription.status,
        subscription.nextBillingDate,
      ],
    );
  }

  async insertTransaction(transaction: {
    id: string;
    subscriptionId: string;
    userId: string;
    amount: number;
    currency: string;
    status: string;
    timestamp: Date;
    txHash?: string;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO transactions
         (id, subscription_id, user_id, amount, currency, status, timestamp, tx_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        transaction.id,
        transaction.subscriptionId,
        transaction.userId,
        transaction.amount,
        transaction.currency,
        transaction.status,
        transaction.timestamp,
        transaction.txHash ?? null,
      ],
    );
  }
}
