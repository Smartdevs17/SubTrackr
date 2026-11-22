import { QueryClient } from '../../../backend/shared/query/queryRouter';

export interface LTVQueryResult {
  month: string;
  averageLtv: number;
  medianLtv: number;
  p25Ltv: number;
  p75Ltv: number;
  refreshedAt: Date;
}

export class LTVQueryHandler {
  constructor(private db: QueryClient) {}

  async getLTV(from?: string, to?: string): Promise<LTVQueryResult[]> {
    let sql = `
      SELECT
        month,
        average_ltv AS "averageLtv",
        median_ltv AS "medianLtv",
        p25_ltv AS "p25Ltv",
        p75_ltv AS "p75Ltv",
        refreshed_at AS "refreshedAt"
      FROM ltv_mv
      WHERE 1=1
    `;
    const params: unknown[] = [];
    if (from) {
      params.push(from);
      sql += ` AND month >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      sql += ` AND month <= $${params.length}`;
    }
    sql += ' ORDER BY month DESC';
    const result = await this.db.query<LTVQueryResult>(sql, params);
    return result.rows;
  }
}
