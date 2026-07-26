/**
 * Lambda handler adaptation for pooled database access.
 *
 * Issue #600 acceptance criteria: "db.release() called after each invocation
 * via finally block." This wrapper makes that guarantee structural — handlers
 * receive a per-invocation client (or transaction) and the release happens in
 * a finally regardless of success, throw, or timeout.
 *
 * Usage:
 *
 *   export const handler = withDatabase(async (event, ctx, db) => {
 *     const { rows } = await db.query('SELECT 1');
 *     return { statusCode: 200, body: JSON.stringify(rows) };
 *   });
 */

import type { PoolClient } from '../shared/db/serverlessPool';
import { getConfiguredServerlessPool } from './dbConfig';

/** Minimal generic Lambda handler signature (provider-agnostic). */
export type LambdaHandler<Event = unknown, Context = unknown, Result = unknown> = (
  event: Event,
  context: Context,
) => Promise<Result>;

export type DatabaseHandler<Event = unknown, Context = unknown, Result = unknown> = (
  event: Event,
  context: Context,
  client: PoolClient,
) => Promise<Result>;

export interface WithDatabaseOptions {
  /** Wrap the handler body in a single transaction. Default: false. */
  transaction?: boolean;
  /** Diagnostic label used in leak-detection logs. */
  origin?: string;
}

/**
 * Wrap a Lambda handler so it runs with a pooled client that is always
 * released after the invocation. The underlying pool is a warm-reused
 * singleton, so the proxy connection is multiplexed across invocations.
 */
export function withDatabase<Event = unknown, Context = unknown, Result = unknown>(
  handler: DatabaseHandler<Event, Context, Result>,
  options: WithDatabaseOptions = {},
): LambdaHandler<Event, Context, Result> {
  const origin = options.origin ?? handler.name ?? 'lambda';

  return async (event, context) => {
    const pool = getConfiguredServerlessPool();
    const run = (client: PoolClient) => handler(event, context, client);
    // withClient / withTransaction both release in a finally block.
    return options.transaction
      ? pool.withTransaction(run, origin)
      : pool.withClient(run, origin);
  };
}
