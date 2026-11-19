/**
 * Audit column utilities (issue #1801).
 *
 * Provides helpers for populating `created_by` and `updated_by` columns
 * from the request context, and for building INSERT/UPDATE statements
 * that include audit attribution.
 *
 * Usage:
 *
 *   import { AuditContext, withAuditColumns } from '../shared/db/auditColumns';
 *
 *   // In a request handler:
 *   const ctx = AuditContext.fromRequest(req); // extracts actorId
 *
 *   // In a repository:
 *   const { sql, params } = withAuditColumns.insert('subscriptions', {
 *     user_id: userId, name, amount, ...
 *   }, ctx);
 *   await pool.query(sql, params);
 */

/** Tables that have created_by / updated_by columns. */
export const AUDIT_TABLES = [
  'subscriptions',
  'transactions',
  'users',
  'merchants',
  'loyalty',
  'payment_methods',
  'plans',
] as const;

export type AuditTable = (typeof AUDIT_TABLES)[number];

/**
 * Carries the actor identity through the request → repository path.
 */
export class AuditContext {
  constructor(
    public readonly actorId: string,
    public readonly actorType: 'user' | 'system' | 'api_key' = 'user',
  ) {}

  /** Build from an HTTP request (extracts user ID from auth header / session). */
  static fromRequest(req: {
    userId?: string;
    user?: { id?: string };
    apiKey?: { id?: string };
  }): AuditContext {
    const actorId =
      req.userId ??
      req.user?.id ??
      req.apiKey?.id ??
      'system';
    const actorType = req.apiKey?.id ? 'api_key' : actorId === 'system' ? 'system' : 'user';
    return new AuditContext(actorId, actorType as 'user' | 'system' | 'api_key');
  }

  /** System context for background jobs / cron. */
  static system(): AuditContext {
    return new AuditContext('system', 'system');
  }

  /** Anonymous context for unauthenticated operations (e.g., signup). */
  static anonymous(): AuditContext {
    return new AuditContext('anonymous', 'system');
  }
}

/**
 * Build INSERT and UPDATE statements that include created_by / updated_by.
 */
export const withAuditColumns = {
  /**
   * Build an INSERT statement with created_by and updated_by.
   *
   * @param table target table
   * @param data column → value map (without audit columns)
   * @param ctx audit context providing the actor ID
   * @returns { sql, params } ready for pool.query(sql, params)
   */
  insert(
    table: string,
    data: Record<string, unknown>,
    ctx: AuditContext,
  ): { sql: string; params: unknown[] } {
    const columns = [...Object.keys(data), 'created_by', 'updated_by'];
    const values = [...Object.values(data), ctx.actorId, ctx.actorId];
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

    return {
      sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
      params: values,
    };
  },

  /**
   * Build an UPDATE statement that sets updated_by.
   *
   * @param table target table
   * @param data column → value map (without audit columns)
   * @param whereClause WHERE clause (e.g., "id = $1")
   * @param whereParams params for the WHERE clause
   * @param ctx audit context providing the actor ID
   * @returns { sql, params } ready for pool.query(sql, params)
   */
  update(
    table: string,
    data: Record<string, unknown>,
    whereClause: string,
    whereParams: unknown[],
    ctx: AuditContext,
  ): { sql: string; params: unknown[] } {
    const entries = Object.entries(data);
    const setColumns = [...entries.map(([col]) => `${col} = $%`), 'updated_by = $%'];
    const params: unknown[] = [];

    let placeholderIdx = 1;
    const setClause = setColumns
      .map((s) => s.replace('$%', `$${placeholderIdx++}`))
      .join(', ');

    params.push(...entries.map(([, val]) => val));
    params.push(ctx.actorId);

    // Append WHERE params
    const whereClauseWithPlaceholders = whereClause.replace(
      /\$(\d+)/g,
      (_, n) => `$${Number(n) + params.length - whereParams.length}`,
    );
    params.push(...whereParams);

    return {
      sql: `UPDATE ${table} SET ${setClause} WHERE ${whereClauseWithPlaceholders}`,
      params,
    };
  },
};
