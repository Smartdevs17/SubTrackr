import { QueryClient } from '../../../backend/shared/query/queryRouter';

export interface CohortRetentionPeriod {
  period: number;
  retained: number;
  retentionPct: number;
}

export interface CohortRetentionResult {
  cohort: string;
  periods: CohortRetentionPeriod[];
}

export class CohortRetentionQueryHandler {
  constructor(private db: QueryClient) {}

  async getCohortRetention(cohort?: string): Promise<CohortRetentionResult[]> {
    let sql = `
      SELECT
        cohort,
        period,
        retained,
        retention_pct AS "retentionPct"
      FROM cohort_retention_mv
      WHERE 1=1
    `;
    const params: unknown[] = [];
    if (cohort) {
      params.push(cohort);
      sql += ` AND cohort = $${params.length}`;
    }
    sql += ' ORDER BY cohort, period';
    const result = await this.db.query<{
      cohort: string;
      period: number;
      retained: number;
      retentionPct: number;
    }>(sql, params);

    const grouped: Map<string, CohortRetentionPeriod[]> = new Map();
    for (const row of result.rows) {
      if (!grouped.has(row.cohort)) {
        grouped.set(row.cohort, []);
      }
      grouped.get(row.cohort)!.push({
        period: row.period,
        retained: row.retained,
        retentionPct: row.retentionPct,
      });
    }

    return Array.from(grouped.entries()).map(([cohort, periods]) => ({
      cohort,
      periods,
    }));
  }
}
