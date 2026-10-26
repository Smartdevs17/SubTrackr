/**
 * Soft-delete utilities (issue #1800).
 *
 * Provides consistent soft-delete filtering, restore, and purge helpers for
 * any table that has a `deleted_at TIMESTAMPTZ` column.
 *
 * Usage in a repository:
 *
 *   import { SoftDeleteHelper } from '../shared/db/softDelete';
 *
 *   class MyRepository {
 *     private sd = new SoftDeleteHelper('subscriptions');
 *
 *     async findActive() {
 *       return this.pool.query(`SELECT * FROM ${this.sd.table}
 *         WHERE ${this.sd.activeFilter()} AND user_id = $1`, [userId]);
 *     }
 *
 *     async softDelete(id: string) {
 *       return this.pool.query(this.sd.softDeleteSql(), [id]);
 *     }
 *
 *     async restore(id: string) {
 *       return this.pool.query(this.sd.restoreSql(), [id]);
 *     }
 *   }
 */

/** Tables that support soft-delete (have a deleted_at column). */
export const SOFT_DELETE_TABLES = [
  'subscriptions',
  'transactions',
  'users',
  'merchants',
  'loyalty',
  'payment_methods',
  'plans',
] as const;

export type SoftDeleteTable = (typeof SOFT_DELETE_TABLES)[number];

/**
 * Helper for building soft-delete SQL fragments consistently across repositories.
 */
export class SoftDeleteHelper {
  constructor(public readonly table: string) {}

  /** WHERE clause fragment: only active (non-deleted) rows */
  activeFilter(): string {
    return `${this.table}.deleted_at IS NULL`;
  }

  /** WHERE clause fragment: only soft-deleted rows */
  deletedFilter(): string {
    return `${this.table}.deleted_at IS NOT NULL`;
  }

  /** SQL to soft-delete a row by id (sets deleted_at to now()) */
  softDeleteSql(): string {
    return `UPDATE ${this.table} SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`;
  }

  /** SQL to restore a soft-deleted row by id (sets deleted_at back to NULL) */
  restoreSql(): string {
    return `UPDATE ${this.table} SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL`;
  }

  /** SQL to count active rows */
  countActiveSql(): string {
    return `SELECT COUNT(*)::int AS count FROM ${this.table} WHERE ${this.activeFilter()}`;
  }

  /** SQL to count soft-deleted rows */
  countDeletedSql(): string {
    return `SELECT COUNT(*)::int AS count FROM ${this.table} WHERE ${this.deletedFilter()}`;
  }

  /** SQL to permanently purge soft-deleted rows older than the given cutoff */
  purgeSql(cutoffDays: number): string {
    return `DELETE FROM ${this.table}
            WHERE deleted_at IS NOT NULL
              AND deleted_at < now() - INTERVAL '${cutoffDays} days'`;
  }

  /** SQL to find soft-deleted rows (for admin restore UI) */
  findDeletedSql(): string {
    return `SELECT * FROM ${this.table} WHERE ${this.deletedFilter()} ORDER BY deleted_at DESC`;
  }
}

/**
 * Pre-built helpers for each soft-delete-enabled table.
 */
export const SOFT_DELETE_HELPERS: Readonly<Record<SoftDeleteTable, SoftDeleteHelper>> =
  Object.fromEntries(
    SOFT_DELETE_TABLES.map((table) => [table, new SoftDeleteHelper(table)]),
  ) as Readonly<Record<SoftDeleteTable, SoftDeleteHelper>>;

/**
 * Patch a SELECT query to filter out soft-deleted rows.
 * Appends `AND <table>.deleted_at IS NULL` to the WHERE clause,
 * or adds a WHERE clause if none exists.
 */
export function filterActive(sql: string, table: string): string {
  const fragment = `${table}.deleted_at IS NULL`;

  // Check if there's already a WHERE clause
  const whereMatch = /\bWHERE\b/i.exec(sql);
  if (whereMatch) {
    // Insert after the existing WHERE
    const insertPos = whereMatch.index + whereMatch[0].length;
    return sql.slice(0, insertPos) + ' ' + fragment + ' AND' + sql.slice(insertPos);
  }

  // No WHERE clause — check for GROUP BY, ORDER BY, LIMIT
  const clauseMatch = /\b(GROUP\s+BY|ORDER\s+BY|LIMIT|HAVING)\b/i.exec(sql);
  if (clauseMatch) {
    const insertPos = clauseMatch.index;
    return sql.slice(0, insertPos) + `WHERE ${fragment} ` + sql.slice(insertPos);
  }

  // No clauses — append WHERE at the end
  return sql + ` WHERE ${fragment}`;
}
