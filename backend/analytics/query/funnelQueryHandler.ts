/**
 * Subscription Funnel Query Handler
 *
 * Queries subscription funnel stages from the `subscription_funnel_mv`
 * materialized view, tracking conversion rates through each stage:
 *   Visitor → Signup → Trial → Paid → Retained
 *
 * Closes #1148
 */

import { QueryClient } from '../../../backend/shared/query/queryRouter';

export type FunnelStage =
  | 'visitor'
  | 'signup'
  | 'trial_started'
  | 'trial_completed'
  | 'paid_conversion'
  | 'retained_30d';

export interface FunnelStageResult {
  stage: FunnelStage;
  label: string;
  count: number;
  conversionRate: number;
  dropOffRate: number;
  dropOffCount: number;
}

export interface FunnelQueryResult {
  period: string;
  cohort: string | null;
  stages: FunnelStageResult[];
  overallConversionRate: number;
  totalVisitors: number;
  totalConversions: number;
  refreshedAt: Date;
}

export class FunnelQueryHandler {
  constructor(private db: QueryClient) {}

  /**
   * Get funnel analysis for a date range, optionally filtered by cohort/channel.
   */
  async getFunnel(
    from?: string,
    to?: string,
    cohort?: string,
  ): Promise<FunnelQueryResult[]> {
    let sql = `
      SELECT
        period,
        cohort,
        visitor_count,
        signup_count,
        trial_started_count,
        trial_completed_count,
        paid_conversion_count,
        retained_30d_count,
        refreshed_at AS "refreshedAt"
      FROM subscription_funnel_mv
      WHERE 1=1
    `;
    const params: unknown[] = [];
    if (from) {
      params.push(from);
      sql += ` AND period >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      sql += ` AND period <= $${params.length}`;
    }
    if (cohort) {
      params.push(cohort);
      sql += ` AND cohort = $${params.length}`;
    }
    sql += ' ORDER BY period DESC';

    const result = await this.db.query<{
      period: string;
      cohort: string | null;
      visitor_count: number;
      signup_count: number;
      trial_started_count: number;
      trial_completed_count: number;
      paid_conversion_count: number;
      retained_30d_count: number;
      refreshedAt: Date;
    }>(sql, params);

    return result.rows.map((row) =>
      this.transformRow(row),
    );
  }

  /**
   * Get aggregated funnel across all periods in a date range.
   */
  async getAggregatedFunnel(
    from?: string,
    to?: string,
  ): Promise<FunnelQueryResult> {
    let sql = `
      SELECT
        'aggregated' AS period,
        NULL AS cohort,
        SUM(visitor_count) AS visitor_count,
        SUM(signup_count) AS signup_count,
        SUM(trial_started_count) AS trial_started_count,
        SUM(trial_completed_count) AS trial_completed_count,
        SUM(paid_conversion_count) AS paid_conversion_count,
        SUM(retained_30d_count) AS retained_30d_count,
        MAX(refreshed_at) AS "refreshedAt"
      FROM subscription_funnel_mv
      WHERE 1=1
    `;
    const params: unknown[] = [];
    if (from) {
      params.push(from);
      sql += ` AND period >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      sql += ` AND period <= $${params.length}`;
    }

    const result = await this.db.query<{
      period: string;
      cohort: string | null;
      visitor_count: number;
      signup_count: number;
      trial_started_count: number;
      trial_completed_count: number;
      paid_conversion_count: number;
      retained_30d_count: number;
      refreshedAt: Date;
    }>(sql, params);

    if (result.rows.length === 0) {
      return this.emptyResult();
    }
    return this.transformRow(result.rows[0]);
  }

  /**
   * Compare funnels across different cohorts/channels.
   */
  async compareCohorts(
    from?: string,
    to?: string,
  ): Promise<FunnelQueryResult[]> {
    let sql = `
      SELECT
        period,
        cohort,
        SUM(visitor_count) AS visitor_count,
        SUM(signup_count) AS signup_count,
        SUM(trial_started_count) AS trial_started_count,
        SUM(trial_completed_count) AS trial_completed_count,
        SUM(paid_conversion_count) AS paid_conversion_count,
        SUM(retained_30d_count) AS retained_30d_count,
        MAX(refreshed_at) AS "refreshedAt"
      FROM subscription_funnel_mv
      WHERE cohort IS NOT NULL
    `;
    const params: unknown[] = [];
    if (from) {
      params.push(from);
      sql += ` AND period >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      sql += ` AND period <= $${params.length}`;
    }
    sql += ' GROUP BY period, cohort ORDER BY period DESC, cohort ASC';

    const result = await this.db.query<{
      period: string;
      cohort: string | null;
      visitor_count: number;
      signup_count: number;
      trial_started_count: number;
      trial_completed_count: number;
      paid_conversion_count: number;
      retained_30d_count: number;
      refreshedAt: Date;
    }>(sql, params);

    return result.rows.map((row) => this.transformRow(row));
  }

  private transformRow(row: {
    period: string;
    cohort: string | null;
    visitor_count: number;
    signup_count: number;
    trial_started_count: number;
    trial_completed_count: number;
    paid_conversion_count: number;
    retained_30d_count: number;
    refreshedAt: Date;
  }): FunnelQueryResult {
    const counts = [
      row.visitor_count,
      row.signup_count,
      row.trial_started_count,
      row.trial_completed_count,
      row.paid_conversion_count,
      row.retained_30d_count,
    ];

    const stageNames: FunnelStage[] = [
      'visitor',
      'signup',
      'trial_started',
      'trial_completed',
      'paid_conversion',
      'retained_30d',
    ];

    const labels = [
      'Visitors',
      'Sign-ups',
      'Trial Started',
      'Trial Completed',
      'Paid Conversion',
      'Retained (30d)',
    ];

    const stages: FunnelStageResult[] = counts.map((count, index) => {
      const previousCount = index > 0 ? counts[index - 1] : count;
      const conversionRate = previousCount > 0 ? (count / previousCount) * 100 : 0;
      const dropOffCount = previousCount - count;
      const dropOffRate = previousCount > 0 ? (dropOffCount / previousCount) * 100 : 0;

      return {
        stage: stageNames[index],
        label: labels[index],
        count,
        conversionRate: Math.round(conversionRate * 100) / 100,
        dropOffRate: Math.round(dropOffRate * 100) / 100,
        dropOffCount: Math.max(dropOffCount, 0),
      };
    });

    const overallConversionRate =
      row.visitor_count > 0
        ? Math.round((row.retained_30d_count / row.visitor_count) * 10000) / 100
        : 0;

    return {
      period: row.period,
      cohort: row.cohort,
      stages,
      overallConversionRate,
      totalVisitors: row.visitor_count,
      totalConversions: row.retained_30d_count,
      refreshedAt: row.refreshedAt,
    };
  }

  private emptyResult(): FunnelQueryResult {
    return {
      period: 'N/A',
      cohort: null,
      stages: [],
      overallConversionRate: 0,
      totalVisitors: 0,
      totalConversions: 0,
      refreshedAt: new Date(),
    };
  }
}
