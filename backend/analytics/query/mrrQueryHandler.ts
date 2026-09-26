import { QueryClient } from '../../../backend/shared/query/queryRouter';

export interface MRRQueryResult {
  month: string;
  mrr: number;
  newSubscriptions: number;
  upgrades: number;
  downgrades: number;
  churn: number;
  refreshedAt: Date;
}

export class MRRQueryHandler {
  constructor(private db: QueryClient) {}

  async getMRR(from?: string, to?: string): Promise<MRRQueryResult[]> {
    let sql = `
      SELECT
        month,
        mrr,
        new_subscriptions AS "newSubscriptions",
        upgrades,
        downgrades,
        churn,
        refreshed_at AS "refreshedAt"
      FROM mrr_mv
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
    const result = await this.db.query<MRRQueryResult>(sql, params);
    return result.rows;
  }
}
