/**
 * Geographic Revenue Breakdown Query Handler
 *
 * Queries revenue breakdown by geographic region from the
 * `geographic_revenue_mv` materialized view.
 *
 * Closes #1149
 */

import { QueryClient } from '../../../backend/shared/query/queryRouter';

export interface GeographicRevenueResult {
  country: string;
  countryCode: string;
  region: string;
  mrr: number;
  arr: number;
  subscriberCount: number;
  arpu: number;
  revenueShare: number;
  growthRate: number;
  churnRate: number;
  refreshedAt: Date;
}

export interface GeographicSummaryResult {
  totalMRR: number;
  totalARR: number;
  totalSubscribers: number;
  countryCount: number;
  topCountry: string;
  topCountryMRR: number;
  avgGrowthRate: number;
  regions: { region: string; mrr: number; share: number; subscriberCount: number }[];
  refreshedAt: Date;
}

export class GeographicRevenueQueryHandler {
  constructor(private db: QueryClient) {}

  /**
   * Get revenue breakdown by country, optionally filtered by region and date range.
   */
  async getRevenueByCountry(
    from?: string,
    to?: string,
    region?: string,
  ): Promise<GeographicRevenueResult[]> {
    let sql = `
      SELECT
        country,
        country_code AS "countryCode",
        region,
        mrr,
        arr,
        subscriber_count AS "subscriberCount",
        arpu,
        revenue_share AS "revenueShare",
        growth_rate AS "growthRate",
        churn_rate AS "churnRate",
        refreshed_at AS "refreshedAt"
      FROM geographic_revenue_mv
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
    if (region) {
      params.push(region);
      sql += ` AND region = $${params.length}`;
    }
    sql += ' ORDER BY mrr DESC';

    const result = await this.db.query<GeographicRevenueResult>(sql, params);
    return result.rows;
  }

  /**
   * Get aggregated geographic revenue summary.
   */
  async getSummary(from?: string, to?: string): Promise<GeographicSummaryResult> {
    let sql = `
      SELECT
        SUM(mrr) AS "totalMRR",
        SUM(arr) AS "totalARR",
        SUM(subscriber_count) AS "totalSubscribers",
        COUNT(DISTINCT country) AS "countryCount",
        MAX(refreshed_at) AS "refreshedAt"
      FROM geographic_revenue_mv
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

    const summaryResult = await this.db.query<{
      totalMRR: number;
      totalARR: number;
      totalSubscribers: number;
      countryCount: number;
      refreshedAt: Date;
    }>(sql, params);

    if (summaryResult.rows.length === 0 || !summaryResult.rows[0].totalMRR) {
      return this.emptySummary();
    }

    const summary = summaryResult.rows[0];

    // Get top country
    const topCountrySql = `
      SELECT country, mrr
      FROM geographic_revenue_mv
      ${from || to ? 'WHERE 1=1' : ''}
      ${from ? `AND period >= $1` : ''}
      ${to ? `AND period <= $${from ? 2 : 1}` : ''}
      ORDER BY mrr DESC
      LIMIT 1
    `;
    const topParams: unknown[] = [];
    if (from) topParams.push(from);
    if (to) topParams.push(to);
    const topResult = await this.db.query<{ country: string; mrr: number }>(
      topCountrySql,
      topParams,
    );

    // Get regional aggregation
    const regionSql = `
      SELECT
        region,
        SUM(mrr) AS mrr,
        SUM(subscriber_count) AS "subscriberCount"
      FROM geographic_revenue_mv
      ${from || to ? 'WHERE 1=1' : ''}
      ${from ? `AND period >= $1` : ''}
      ${to ? `AND period <= $${from ? 2 : 1}` : ''}
      GROUP BY region
      ORDER BY mrr DESC
    `;
    const regionResult = await this.db.query<{
      region: string;
      mrr: number;
      subscriberCount: number;
    }>(regionSql, topParams);

    const totalMRR = Number(summary.totalMRR) || 0;
    const regions = regionResult.rows.map((r) => ({
      region: r.region,
      mrr: Number(r.mrr) || 0,
      share: totalMRR > 0 ? ((Number(r.mrr) || 0) / totalMRR) * 100 : 0,
      subscriberCount: Number(r.subscriberCount) || 0,
    }));

    // Calculate average growth rate
    const growthSql = `
      SELECT AVG(growth_rate) AS "avgGrowthRate"
      FROM geographic_revenue_mv
      ${from || to ? 'WHERE 1=1' : ''}
      ${from ? `AND period >= $1` : ''}
      ${to ? `AND period <= $${from ? 2 : 1}` : ''}
    `;
    const growthResult = await this.db.query<{ avgGrowthRate: number }>(growthSql, topParams);

    return {
      totalMRR,
      totalARR: Number(summary.totalARR) || 0,
      totalSubscribers: Number(summary.totalSubscribers) || 0,
      countryCount: Number(summary.countryCount) || 0,
      topCountry: topResult.rows[0]?.country ?? 'N/A',
      topCountryMRR: Number(topResult.rows[0]?.mrr) || 0,
      avgGrowthRate: Number(growthResult.rows[0]?.avgGrowthRate) || 0,
      regions,
      refreshedAt: summary.refreshedAt,
    };
  }

  /**
   * Get revenue trend by region over time.
   */
  async getRevenueTrendByRegion(
    from?: string,
    to?: string,
  ): Promise<{ period: string; region: string; mrr: number; subscriberCount: number }[]> {
    let sql = `
      SELECT
        period,
        region,
        SUM(mrr) AS mrr,
        SUM(subscriber_count) AS "subscriberCount"
      FROM geographic_revenue_mv
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
    sql += ' GROUP BY period, region ORDER BY period DESC, mrr DESC';

    const result = await this.db.query<{
      period: string;
      region: string;
      mrr: number;
      subscriberCount: number;
    }>(sql, params);

    return result.rows.map((r) => ({
      period: r.period,
      region: r.region,
      mrr: Number(r.mrr) || 0,
      subscriberCount: Number(r.subscriberCount) || 0,
    }));
  }

  private emptySummary(): GeographicSummaryResult {
    return {
      totalMRR: 0,
      totalARR: 0,
      totalSubscribers: 0,
      countryCount: 0,
      topCountry: 'N/A',
      topCountryMRR: 0,
      avgGrowthRate: 0,
      regions: [],
      refreshedAt: new Date(),
    };
  }
}
