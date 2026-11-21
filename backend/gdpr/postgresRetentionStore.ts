/**
 * PostgreSQL-backed retention data store (issue #1799).
 *
 * Implements the RetentionDataStore interface against actual database tables,
 * so the DataRetentionService can purge expired records from PostgreSQL
 * instead of relying on in-memory mocks.
 */

import type { Pool } from '../shared/db/connectionPool';
import type { RetentionDataStore, RetentionRecord } from './dataRetentionService';

export interface PostgresRetentionStoreConfig {
  sourceName: string;
  table: string;
  timestampColumn?: string;
  idColumn?: string;
  userIdColumn?: string;
}

export class PostgresRetentionStore implements RetentionDataStore {
  public readonly sourceName: string;
  private readonly table: string;
  private readonly tsCol: string;
  private readonly idCol: string;
  private readonly userIdCol: string;

  constructor(
    private pool: Pool,
    config: PostgresRetentionStoreConfig,
  ) {
    this.sourceName = config.sourceName;
    this.table = config.table;
    this.tsCol = config.timestampColumn ?? 'created_at';
    this.idCol = config.idColumn ?? 'id';
    this.userIdCol = config.userIdColumn ?? 'user_id';
  }

  async findExpired(cutoff: number, limit: number): Promise<RetentionRecord[]> {
    const cutoffDate = new Date(cutoff).toISOString();
    const result = await this.pool.query<{
      id: string; user_id: string | null; ts: number | Date;
    }>(
      `SELECT ${this.idCol} AS id, ${this.userIdCol} AS user_id, ${this.tsCol} AS ts
       FROM ${this.table}
       WHERE ${this.tsCol} <= $1
         AND ${this.idCol} NOT IN (
           SELECT target_id::text FROM retention_legal_holds
           WHERE scope = 'record' AND released_at IS NULL
             AND (source IS NULL OR source = $2))
         AND (${this.userIdCol} IS NULL OR ${this.userIdCol} NOT IN (
           SELECT target_id::text FROM retention_legal_holds
           WHERE scope = 'user' AND released_at IS NULL
             AND (source IS NULL OR source = $2)))
       ORDER BY ${this.tsCol} ASC LIMIT $3`,
      [cutoffDate, this.sourceName, limit],
    );
    return result.rows.map((r) => ({
      id: r.id, userId: r.user_id ?? undefined,
      timestamp: typeof r.ts === 'number' ? r.ts : r.ts.getTime(),
    }));
  }

  async deleteRecords(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.pool.query(
      `DELETE FROM ${this.table} WHERE ${this.idCol} = ANY($1::text[])`, [ids]);
    return result.rowCount ?? 0;
  }

  async anonymizeRecords(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.pool.query(
      `UPDATE ${this.table} SET email = NULL, name = NULL, phone = NULL, address = NULL
       WHERE ${this.idCol} = ANY($1::text[])`, [ids]);
    return result.rowCount ?? 0;
  }

  async archiveRecords(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.pool.query(
      `UPDATE ${this.table} SET archived_at = now() WHERE ${this.idCol} = ANY($1::text[])`, [ids]);
    return result.rowCount ?? 0;
  }
}

export function createDefaultRetentionStores(pool: Pool): Map<string, PostgresRetentionStore> {
  const configs: PostgresRetentionStoreConfig[] = [
    { sourceName: 'activity_logs', table: 'activity_logs' },
    { sourceName: 'notifications', table: 'notifications' },
    { sourceName: 'billing_records', table: 'billing_records' },
    { sourceName: 'audit_logs', table: 'audit_events', timestampColumn: 'created_at' },
  ];
  const stores = new Map<string, PostgresRetentionStore>();
  for (const c of configs) stores.set(c.sourceName, new PostgresRetentionStore(pool, c));
  return stores;
}
