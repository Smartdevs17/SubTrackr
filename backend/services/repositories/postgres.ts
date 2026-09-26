/**
 * PostgreSQL repository implementations — Issue #405.
 *
 * Each class maps a domain entity to a PostgreSQL table using parameterised
 * queries (prevents SQL injection) and the shared read/write pool.
 *
 * Repositories are instantiated per request through the IoC container and
 * share a single connection pool. Transactions are handled via
 * PostgresUnitOfWork which wraps operations in a single PoolClient.
 */

import type { Pool, PoolClient } from '../../shared/db/connectionPool';
import type {
  IRepository,
  ISubscriptionRepository,
  ITransactionRepository,
  IUserRepository,
  IMerchantRepository,
  ILoyaltyRepository,
  IUnitOfWork,
  Page,
  QueryOptions,
  TransactionContext,
  Subscription,
  Transaction,
  User,
  MerchantRecord,
  LoyaltyRecord,
} from './interfaces';

// ─── Transaction context ──────────────────────────────────────────────────────

/** Extend TransactionContext to carry the live PoolClient during a UoW run. */
export interface PgTransactionContext extends TransactionContext {
  client: PoolClient;
}

function isPgContext(tx?: TransactionContext): tx is PgTransactionContext {
  return !!tx && typeof (tx as PgTransactionContext).client === 'object';
}

// ─── Query helper ─────────────────────────────────────────────────────────────

type Queryable = {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
};

function queryable(pool: Pool, tx?: TransactionContext): Queryable {
  return isPgContext(tx) ? tx.client : pool;
}

function buildPagination(opts: QueryOptions = {}): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];

  if (opts.orderBy) {
    const dir = opts.orderDir === 'desc' ? 'DESC' : 'ASC';
    // Whitelist orderBy to prevent injection
    const safeColumn = opts.orderBy.replace(/[^a-zA-Z0-9_]/g, '');
    parts.push(`ORDER BY ${safeColumn} ${dir}`);
  }

  let idx = 1;
  if (opts.limit != null) {
    parts.push(`LIMIT $${idx++}`);
    params.push(opts.limit);
  }
  if (opts.offset != null) {
    parts.push(`OFFSET $${idx++}`);
    params.push(opts.offset);
  }

  return { sql: parts.join(' '), params };
}

// ─── Subscription repository ──────────────────────────────────────────────────

export class PgSubscriptionRepository implements ISubscriptionRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string, tx?: TransactionContext): Promise<Subscription | null> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<Subscription>(
      `SELECT id, user_id AS "userId", name, amount, currency, billing_cycle AS "billingCycle",
              status, next_billing_date AS "nextBillingDate", created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM subscriptions WHERE id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findAll(opts: QueryOptions = {}, tx?: TransactionContext): Promise<Page<Subscription>> {
    const q = queryable(this.pool, tx);
    const pg = buildPagination(opts);

    const countRow = await q.query<{ count: string }>('SELECT COUNT(*) AS count FROM subscriptions');
    const total = parseInt(countRow.rows[0]?.count ?? '0', 10);

    const { rows } = await q.query<Subscription>(
      `SELECT id, user_id AS "userId", name, amount, currency, billing_cycle AS "billingCycle",
              status, next_billing_date AS "nextBillingDate", created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM subscriptions ${pg.sql}`,
      pg.params,
    );

    return { items: rows, total, offset: opts.offset ?? 0, limit: opts.limit ?? total };
  }

  async save(entity: Subscription, tx?: TransactionContext): Promise<Subscription> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<Subscription>(
      `INSERT INTO subscriptions
         (id, user_id, name, amount, currency, billing_cycle, status, next_billing_date, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         amount = EXCLUDED.amount,
         currency = EXCLUDED.currency,
         billing_cycle = EXCLUDED.billing_cycle,
         status = EXCLUDED.status,
         next_billing_date = EXCLUDED.next_billing_date,
         updated_at = EXCLUDED.updated_at
       RETURNING id, user_id AS "userId", name, amount, currency, billing_cycle AS "billingCycle",
                 status, next_billing_date AS "nextBillingDate", created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [
        entity.id,
        entity.userId,
        entity.name,
        entity.amount,
        entity.currency,
        entity.billingCycle,
        entity.status,
        entity.nextBillingDate,
        entity.createdAt,
        entity.updatedAt,
      ],
    );
    return rows[0]!;
  }

  async delete(id: string, tx?: TransactionContext): Promise<void> {
    const q = queryable(this.pool, tx);
    await q.query('DELETE FROM subscriptions WHERE id = $1', [id]);
  }

  async exists(id: string, tx?: TransactionContext): Promise<boolean> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM subscriptions WHERE id = $1) AS exists',
      [id],
    );
    return rows[0]?.exists ?? false;
  }

  async findByUserId(userId: string, opts: QueryOptions = {}, tx?: TransactionContext): Promise<Page<Subscription>> {
    const q = queryable(this.pool, tx);
    const pg = buildPagination(opts);

    const countRow = await q.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM subscriptions WHERE user_id = $1',
      [userId],
    );
    const total = parseInt(countRow.rows[0]?.count ?? '0', 10);

    const { rows } = await q.query<Subscription>(
      `SELECT id, user_id AS "userId", name, amount, currency, billing_cycle AS "billingCycle",
              status, next_billing_date AS "nextBillingDate", created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM subscriptions WHERE user_id = $1 ${pg.sql}`,
      [userId, ...pg.params],
    );
    return { items: rows, total, offset: opts.offset ?? 0, limit: opts.limit ?? total };
  }

  async findByStatus(status: Subscription['status'], opts: QueryOptions = {}, tx?: TransactionContext): Promise<Page<Subscription>> {
    const q = queryable(this.pool, tx);
    const pg = buildPagination(opts);

    const countRow = await q.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM subscriptions WHERE status = $1',
      [status],
    );
    const total = parseInt(countRow.rows[0]?.count ?? '0', 10);

    const { rows } = await q.query<Subscription>(
      `SELECT id, user_id AS "userId", name, amount, currency, billing_cycle AS "billingCycle",
              status, next_billing_date AS "nextBillingDate", created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM subscriptions WHERE status = $1 ${pg.sql}`,
      [status, ...pg.params],
    );
    return { items: rows, total, offset: opts.offset ?? 0, limit: opts.limit ?? total };
  }

  async findDueBefore(date: Date, tx?: TransactionContext): Promise<Subscription[]> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<Subscription>(
      `SELECT id, user_id AS "userId", name, amount, currency, billing_cycle AS "billingCycle",
              status, next_billing_date AS "nextBillingDate", created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM subscriptions WHERE status = 'active' AND next_billing_date <= $1`,
      [date],
    );
    return rows;
  }
}

// ─── Transaction repository ───────────────────────────────────────────────────

export class PgTransactionRepository implements ITransactionRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string, tx?: TransactionContext): Promise<Transaction | null> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<Transaction>(
      `SELECT id, subscription_id AS "subscriptionId", user_id AS "userId",
              amount, currency, status, timestamp, tx_hash AS "txHash"
       FROM transactions WHERE id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findAll(opts: QueryOptions = {}, tx?: TransactionContext): Promise<Page<Transaction>> {
    const q = queryable(this.pool, tx);
    const pg = buildPagination(opts);
    const countRow = await q.query<{ count: string }>('SELECT COUNT(*) AS count FROM transactions');
    const total = parseInt(countRow.rows[0]?.count ?? '0', 10);

    const { rows } = await q.query<Transaction>(
      `SELECT id, subscription_id AS "subscriptionId", user_id AS "userId",
              amount, currency, status, timestamp, tx_hash AS "txHash"
       FROM transactions ${pg.sql}`,
      pg.params,
    );
    return { items: rows, total, offset: opts.offset ?? 0, limit: opts.limit ?? total };
  }

  async save(entity: Transaction, tx?: TransactionContext): Promise<Transaction> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<Transaction>(
      `INSERT INTO transactions
         (id, subscription_id, user_id, amount, currency, status, timestamp, tx_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         tx_hash = EXCLUDED.tx_hash
       RETURNING id, subscription_id AS "subscriptionId", user_id AS "userId",
                 amount, currency, status, timestamp, tx_hash AS "txHash"`,
      [
        entity.id,
        entity.subscriptionId,
        entity.userId,
        entity.amount,
        entity.currency,
        entity.status,
        entity.timestamp,
        entity.txHash ?? null,
      ],
    );
    return rows[0]!;
  }

  async delete(id: string, tx?: TransactionContext): Promise<void> {
    const q = queryable(this.pool, tx);
    await q.query('DELETE FROM transactions WHERE id = $1', [id]);
  }

  async exists(id: string, tx?: TransactionContext): Promise<boolean> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM transactions WHERE id = $1) AS exists',
      [id],
    );
    return rows[0]?.exists ?? false;
  }

  async findBySubscriptionId(subscriptionId: string, opts: QueryOptions = {}, tx?: TransactionContext): Promise<Page<Transaction>> {
    const q = queryable(this.pool, tx);
    const pg = buildPagination(opts);
    const countRow = await q.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM transactions WHERE subscription_id = $1',
      [subscriptionId],
    );
    const total = parseInt(countRow.rows[0]?.count ?? '0', 10);
    const { rows } = await q.query<Transaction>(
      `SELECT id, subscription_id AS "subscriptionId", user_id AS "userId",
              amount, currency, status, timestamp, tx_hash AS "txHash"
       FROM transactions WHERE subscription_id = $1 ${pg.sql}`,
      [subscriptionId, ...pg.params],
    );
    return { items: rows, total, offset: opts.offset ?? 0, limit: opts.limit ?? total };
  }

  async findByUserId(userId: string, opts: QueryOptions = {}, tx?: TransactionContext): Promise<Page<Transaction>> {
    const q = queryable(this.pool, tx);
    const pg = buildPagination(opts);
    const countRow = await q.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM transactions WHERE user_id = $1',
      [userId],
    );
    const total = parseInt(countRow.rows[0]?.count ?? '0', 10);
    const { rows } = await q.query<Transaction>(
      `SELECT id, subscription_id AS "subscriptionId", user_id AS "userId",
              amount, currency, status, timestamp, tx_hash AS "txHash"
       FROM transactions WHERE user_id = $1 ${pg.sql}`,
      [userId, ...pg.params],
    );
    return { items: rows, total, offset: opts.offset ?? 0, limit: opts.limit ?? total };
  }

  async findByStatus(status: Transaction['status'], tx?: TransactionContext): Promise<Transaction[]> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<Transaction>(
      `SELECT id, subscription_id AS "subscriptionId", user_id AS "userId",
              amount, currency, status, timestamp, tx_hash AS "txHash"
       FROM transactions WHERE status = $1`,
      [status],
    );
    return rows;
  }
}

// ─── User repository ──────────────────────────────────────────────────────────

export class PgUserRepository implements IUserRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string, tx?: TransactionContext): Promise<User | null> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<User>(
      `SELECT id, address, email, created_at AS "createdAt" FROM users WHERE id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findAll(opts: QueryOptions = {}, tx?: TransactionContext): Promise<Page<User>> {
    const q = queryable(this.pool, tx);
    const pg = buildPagination(opts);
    const countRow = await q.query<{ count: string }>('SELECT COUNT(*) AS count FROM users');
    const total = parseInt(countRow.rows[0]?.count ?? '0', 10);
    const { rows } = await q.query<User>(
      `SELECT id, address, email, created_at AS "createdAt" FROM users ${pg.sql}`,
      pg.params,
    );
    return { items: rows, total, offset: opts.offset ?? 0, limit: opts.limit ?? total };
  }

  async save(entity: User, tx?: TransactionContext): Promise<User> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<User>(
      `INSERT INTO users (id, address, email, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET address = EXCLUDED.address, email = EXCLUDED.email
       RETURNING id, address, email, created_at AS "createdAt"`,
      [entity.id, entity.address, entity.email ?? null, entity.createdAt],
    );
    return rows[0]!;
  }

  async delete(id: string, tx?: TransactionContext): Promise<void> {
    const q = queryable(this.pool, tx);
    await q.query('DELETE FROM users WHERE id = $1', [id]);
  }

  async exists(id: string, tx?: TransactionContext): Promise<boolean> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM users WHERE id = $1) AS exists',
      [id],
    );
    return rows[0]?.exists ?? false;
  }

  async findByAddress(address: string, tx?: TransactionContext): Promise<User | null> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<User>(
      `SELECT id, address, email, created_at AS "createdAt" FROM users WHERE address = $1 LIMIT 1`,
      [address],
    );
    return rows[0] ?? null;
  }

  async findByEmail(email: string, tx?: TransactionContext): Promise<User | null> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<User>(
      `SELECT id, address, email, created_at AS "createdAt" FROM users WHERE email = $1 LIMIT 1`,
      [email],
    );
    return rows[0] ?? null;
  }
}

// ─── Merchant repository ──────────────────────────────────────────────────────

export class PgMerchantRepository implements IMerchantRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string, tx?: TransactionContext): Promise<MerchantRecord | null> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<MerchantRecord>(
      `SELECT id, merchant_address AS "merchantAddress", status, verification_tier AS "verificationTier",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM merchants WHERE id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findAll(opts: QueryOptions = {}, tx?: TransactionContext): Promise<Page<MerchantRecord>> {
    const q = queryable(this.pool, tx);
    const pg = buildPagination(opts);
    const countRow = await q.query<{ count: string }>('SELECT COUNT(*) AS count FROM merchants');
    const total = parseInt(countRow.rows[0]?.count ?? '0', 10);
    const { rows } = await q.query<MerchantRecord>(
      `SELECT id, merchant_address AS "merchantAddress", status, verification_tier AS "verificationTier",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM merchants ${pg.sql}`,
      pg.params,
    );
    return { items: rows, total, offset: opts.offset ?? 0, limit: opts.limit ?? total };
  }

  async save(entity: MerchantRecord, tx?: TransactionContext): Promise<MerchantRecord> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<MerchantRecord>(
      `INSERT INTO merchants (id, merchant_address, status, verification_tier, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         verification_tier = EXCLUDED.verification_tier,
         updated_at = EXCLUDED.updated_at
       RETURNING id, merchant_address AS "merchantAddress", status, verification_tier AS "verificationTier",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        entity.id,
        entity.merchantAddress,
        entity.status,
        entity.verificationTier ?? null,
        entity.createdAt,
        entity.updatedAt,
      ],
    );
    return rows[0]!;
  }

  async delete(id: string, tx?: TransactionContext): Promise<void> {
    const q = queryable(this.pool, tx);
    await q.query('DELETE FROM merchants WHERE id = $1', [id]);
  }

  async exists(id: string, tx?: TransactionContext): Promise<boolean> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM merchants WHERE id = $1) AS exists',
      [id],
    );
    return rows[0]?.exists ?? false;
  }

  async findByAddress(address: string, tx?: TransactionContext): Promise<MerchantRecord | null> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<MerchantRecord>(
      `SELECT id, merchant_address AS "merchantAddress", status, verification_tier AS "verificationTier",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM merchants WHERE merchant_address = $1 LIMIT 1`,
      [address],
    );
    return rows[0] ?? null;
  }

  async findByStatus(status: string, tx?: TransactionContext): Promise<MerchantRecord[]> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<MerchantRecord>(
      `SELECT id, merchant_address AS "merchantAddress", status, verification_tier AS "verificationTier",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM merchants WHERE status = $1`,
      [status],
    );
    return rows;
  }
}

// ─── Loyalty repository ───────────────────────────────────────────────────────

export class PgLoyaltyRepository implements ILoyaltyRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string, tx?: TransactionContext): Promise<LoyaltyRecord | null> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<LoyaltyRecord>(
      `SELECT id, subscriber_id AS "subscriberId", points, lifetime_points AS "lifetimePoints",
              tier, streak_current AS "streakCurrent", streak_longest AS "streakLongest",
              updated_at AS "updatedAt"
       FROM loyalty WHERE id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findAll(opts: QueryOptions = {}, tx?: TransactionContext): Promise<Page<LoyaltyRecord>> {
    const q = queryable(this.pool, tx);
    const pg = buildPagination(opts);
    const countRow = await q.query<{ count: string }>('SELECT COUNT(*) AS count FROM loyalty');
    const total = parseInt(countRow.rows[0]?.count ?? '0', 10);
    const { rows } = await q.query<LoyaltyRecord>(
      `SELECT id, subscriber_id AS "subscriberId", points, lifetime_points AS "lifetimePoints",
              tier, streak_current AS "streakCurrent", streak_longest AS "streakLongest",
              updated_at AS "updatedAt"
       FROM loyalty ${pg.sql}`,
      pg.params,
    );
    return { items: rows, total, offset: opts.offset ?? 0, limit: opts.limit ?? total };
  }

  async save(entity: LoyaltyRecord, tx?: TransactionContext): Promise<LoyaltyRecord> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<LoyaltyRecord>(
      `INSERT INTO loyalty
         (id, subscriber_id, points, lifetime_points, tier, streak_current, streak_longest, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         points = EXCLUDED.points,
         lifetime_points = EXCLUDED.lifetime_points,
         tier = EXCLUDED.tier,
         streak_current = EXCLUDED.streak_current,
         streak_longest = EXCLUDED.streak_longest,
         updated_at = EXCLUDED.updated_at
       RETURNING id, subscriber_id AS "subscriberId", points, lifetime_points AS "lifetimePoints",
                 tier, streak_current AS "streakCurrent", streak_longest AS "streakLongest",
                 updated_at AS "updatedAt"`,
      [
        entity.id,
        entity.subscriberId,
        entity.points,
        entity.lifetimePoints,
        entity.tier,
        entity.streakCurrent,
        entity.streakLongest,
        entity.updatedAt,
      ],
    );
    return rows[0]!;
  }

  async delete(id: string, tx?: TransactionContext): Promise<void> {
    const q = queryable(this.pool, tx);
    await q.query('DELETE FROM loyalty WHERE id = $1', [id]);
  }

  async exists(id: string, tx?: TransactionContext): Promise<boolean> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM loyalty WHERE id = $1) AS exists',
      [id],
    );
    return rows[0]?.exists ?? false;
  }

  async findBySubscriberId(subscriberId: string, tx?: TransactionContext): Promise<LoyaltyRecord | null> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<LoyaltyRecord>(
      `SELECT id, subscriber_id AS "subscriberId", points, lifetime_points AS "lifetimePoints",
              tier, streak_current AS "streakCurrent", streak_longest AS "streakLongest",
              updated_at AS "updatedAt"
       FROM loyalty WHERE subscriber_id = $1 LIMIT 1`,
      [subscriberId],
    );
    return rows[0] ?? null;
  }

  async findTopByPoints(limit: number, tx?: TransactionContext): Promise<LoyaltyRecord[]> {
    const q = queryable(this.pool, tx);
    const { rows } = await q.query<LoyaltyRecord>(
      `SELECT id, subscriber_id AS "subscriberId", points, lifetime_points AS "lifetimePoints",
              tier, streak_current AS "streakCurrent", streak_longest AS "streakLongest",
              updated_at AS "updatedAt"
       FROM loyalty ORDER BY points DESC LIMIT $1`,
      [limit],
    );
    return rows;
  }
}

// ─── PostgreSQL Unit of Work ──────────────────────────────────────────────────

export class PostgresUnitOfWork implements IUnitOfWork {
  subscriptions: ISubscriptionRepository;
  transactions: ITransactionRepository;
  users: IUserRepository;
  merchants: IMerchantRepository;
  loyalty: ILoyaltyRepository;

  constructor(private readonly pool: Pool) {
    this.subscriptions = new PgSubscriptionRepository(pool);
    this.transactions = new PgTransactionRepository(pool);
    this.users = new PgUserRepository(pool);
    this.merchants = new PgMerchantRepository(pool);
    this.loyalty = new PgLoyaltyRepository(pool);
  }

  async run<T>(work: (uow: IUnitOfWork) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const txContext: PgTransactionContext = { id: `pg-tx-${Date.now()}`, client };

      const txUow: IUnitOfWork = {
        subscriptions: new PgSubscriptionRepository(this.pool),
        transactions: new PgTransactionRepository(this.pool),
        users: new PgUserRepository(this.pool),
        merchants: new PgMerchantRepository(this.pool),
        loyalty: new PgLoyaltyRepository(this.pool),
        run: () => Promise.reject(new Error('Nested transactions are not supported')),
      };

      // Patch each repository to use the transaction client
      const bindToTx = <R extends IRepository<unknown>>(repo: R): R => {
        const handler: ProxyHandler<object> = {
          get(target, prop: string) {
            const original = (target as Record<string, unknown>)[prop];
            if (typeof original !== 'function') return original;
            return (...args: unknown[]) => {
              // Inject txContext as the last argument if the function signature ends with an optional tx
              const lastArg = args[args.length - 1];
              if (lastArg && typeof lastArg === 'object' && 'id' in (lastArg as object)) {
                return original.apply(target, args);
              }
              return original.apply(target, [...args, txContext]);
            };
          },
        };
        return new Proxy(repo as object, handler) as R;
      };

      txUow.subscriptions = bindToTx(txUow.subscriptions as PgSubscriptionRepository);
      txUow.transactions = bindToTx(txUow.transactions as PgTransactionRepository);
      txUow.users = bindToTx(txUow.users as PgUserRepository);
      txUow.merchants = bindToTx(txUow.merchants as PgMerchantRepository);
      txUow.loyalty = bindToTx(txUow.loyalty as PgLoyaltyRepository);

      const result = await work(txUow);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createPostgresRepositories(pool: Pool) {
  return {
    subscriptions: new PgSubscriptionRepository(pool),
    transactions: new PgTransactionRepository(pool),
    users: new PgUserRepository(pool),
    merchants: new PgMerchantRepository(pool),
    loyalty: new PgLoyaltyRepository(pool),
    unitOfWork: new PostgresUnitOfWork(pool),
  };
}
