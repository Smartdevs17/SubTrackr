import { Pool, PoolClient } from 'pg';
import {
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

// Helper to paginate array results from DB if not using OFFSET/LIMIT in SQL directly
function paginate<T>(items: T[], opts?: QueryOptions): Page<T> {
  const offset = opts?.offset ?? 0;
  const limit = opts?.limit ?? items.length;
  return { items, total: items.length, offset, limit };
}

export class PostgresSubscriptionRepository implements ISubscriptionRepository {
  constructor(private client: Pool | PoolClient) {}

  async findById(id: string, tx?: TransactionContext): Promise<Subscription | null> {
    const res = await this.client.query('SELECT * FROM subscriptions WHERE id = $1', [id]);
    return res.rows[0] ?? null;
  }

  async findAll(opts?: QueryOptions, tx?: TransactionContext): Promise<Page<Subscription>> {
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 100;
    const res = await this.client.query('SELECT * FROM subscriptions LIMIT $1 OFFSET $2', [limit, offset]);
    return paginate(res.rows, opts);
  }

  async save(entity: Subscription, tx?: TransactionContext): Promise<Subscription> {
    const res = await this.client.query(
      `INSERT INTO subscriptions (id, user_id, name, amount, currency, billing_cycle, status, next_billing_date, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
       name = $3, amount = $4, currency = $5, billing_cycle = $6, status = $7, next_billing_date = $8, updated_at = $10
       RETURNING *`,
      [
        entity.id, entity.userId, entity.name, entity.amount, entity.currency,
        entity.billingCycle, entity.status, entity.nextBillingDate, entity.createdAt, entity.updatedAt
      ]
    );
    return res.rows[0];
  }

  async delete(id: string, tx?: TransactionContext): Promise<void> {
    await this.client.query('DELETE FROM subscriptions WHERE id = $1', [id]);
  }

  async exists(id: string, tx?: TransactionContext): Promise<boolean> {
    const res = await this.client.query('SELECT 1 FROM subscriptions WHERE id = $1', [id]);
    return res.rowCount !== null && res.rowCount > 0;
  }

  async findByUserId(userId: string, opts?: QueryOptions): Promise<Page<Subscription>> {
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 100;
    const res = await this.client.query('SELECT * FROM subscriptions WHERE user_id = $1 LIMIT $2 OFFSET $3', [userId, limit, offset]);
    return paginate(res.rows, opts);
  }

  async findByStatus(status: Subscription['status'], opts?: QueryOptions): Promise<Page<Subscription>> {
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 100;
    const res = await this.client.query('SELECT * FROM subscriptions WHERE status = $1 LIMIT $2 OFFSET $3', [status, limit, offset]);
    return paginate(res.rows, opts);
  }

  async findDueBefore(date: Date): Promise<Subscription[]> {
    const res = await this.client.query("SELECT * FROM subscriptions WHERE status = 'active' AND next_billing_date <= $1", [date]);
    return res.rows;
  }
}

export class PostgresTransactionRepository implements ITransactionRepository {
  constructor(private client: Pool | PoolClient) {}

  async findById(id: string, tx?: TransactionContext): Promise<Transaction | null> {
    const res = await this.client.query('SELECT * FROM transactions WHERE id = $1', [id]);
    return res.rows[0] ?? null;
  }

  async findAll(opts?: QueryOptions, tx?: TransactionContext): Promise<Page<Transaction>> {
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 100;
    const res = await this.client.query('SELECT * FROM transactions LIMIT $1 OFFSET $2', [limit, offset]);
    return paginate(res.rows, opts);
  }

  async save(entity: Transaction, tx?: TransactionContext): Promise<Transaction> {
    const res = await this.client.query(
      `INSERT INTO transactions (id, subscription_id, user_id, amount, currency, status, timestamp, tx_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
       status = $6, tx_hash = $8
       RETURNING *`,
      [
        entity.id, entity.subscriptionId, entity.userId, entity.amount,
        entity.currency, entity.status, entity.timestamp, entity.txHash
      ]
    );
    return res.rows[0];
  }

  async delete(id: string, tx?: TransactionContext): Promise<void> {
    await this.client.query('DELETE FROM transactions WHERE id = $1', [id]);
  }

  async exists(id: string, tx?: TransactionContext): Promise<boolean> {
    const res = await this.client.query('SELECT 1 FROM transactions WHERE id = $1', [id]);
    return res.rowCount !== null && res.rowCount > 0;
  }

  async findBySubscriptionId(subscriptionId: string, opts?: QueryOptions): Promise<Page<Transaction>> {
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 100;
    const res = await this.client.query('SELECT * FROM transactions WHERE subscription_id = $1 LIMIT $2 OFFSET $3', [subscriptionId, limit, offset]);
    return paginate(res.rows, opts);
  }

  async findByUserId(userId: string, opts?: QueryOptions): Promise<Page<Transaction>> {
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 100;
    const res = await this.client.query('SELECT * FROM transactions WHERE user_id = $1 LIMIT $2 OFFSET $3', [userId, limit, offset]);
    return paginate(res.rows, opts);
  }

  async findByStatus(status: Transaction['status']): Promise<Transaction[]> {
    const res = await this.client.query('SELECT * FROM transactions WHERE status = $1', [status]);
    return res.rows;
  }
}

export class PostgresUserRepository implements IUserRepository {
  constructor(private client: Pool | PoolClient) {}

  async findById(id: string, tx?: TransactionContext): Promise<User | null> {
    const res = await this.client.query('SELECT * FROM users WHERE id = $1', [id]);
    return res.rows[0] ?? null;
  }

  async findAll(opts?: QueryOptions, tx?: TransactionContext): Promise<Page<User>> {
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 100;
    const res = await this.client.query('SELECT * FROM users LIMIT $1 OFFSET $2', [limit, offset]);
    return paginate(res.rows, opts);
  }

  async save(entity: User, tx?: TransactionContext): Promise<User> {
    const res = await this.client.query(
      `INSERT INTO users (id, address, email, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
       email = $3
       RETURNING *`,
      [entity.id, entity.address, entity.email, entity.createdAt]
    );
    return res.rows[0];
  }

  async delete(id: string, tx?: TransactionContext): Promise<void> {
    await this.client.query('DELETE FROM users WHERE id = $1', [id]);
  }

  async exists(id: string, tx?: TransactionContext): Promise<boolean> {
    const res = await this.client.query('SELECT 1 FROM users WHERE id = $1', [id]);
    return res.rowCount !== null && res.rowCount > 0;
  }

  async findByAddress(address: string): Promise<User | null> {
    const res = await this.client.query('SELECT * FROM users WHERE address = $1', [address]);
    return res.rows[0] ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const res = await this.client.query('SELECT * FROM users WHERE email = $1', [email]);
    return res.rows[0] ?? null;
  }
}

export class PostgresMerchantRepository implements IMerchantRepository {
  constructor(private client: Pool | PoolClient) {}

  async findById(id: string, tx?: TransactionContext): Promise<MerchantRecord | null> {
    const res = await this.client.query('SELECT * FROM merchants WHERE id = $1', [id]);
    return res.rows[0] ?? null;
  }

  async findAll(opts?: QueryOptions, tx?: TransactionContext): Promise<Page<MerchantRecord>> {
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 100;
    const res = await this.client.query('SELECT * FROM merchants LIMIT $1 OFFSET $2', [limit, offset]);
    return paginate(res.rows, opts);
  }

  async save(entity: MerchantRecord, tx?: TransactionContext): Promise<MerchantRecord> {
    const res = await this.client.query(
      `INSERT INTO merchants (id, merchant_address, status, verification_tier, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
       status = $3, verification_tier = $4, updated_at = $6
       RETURNING *`,
      [entity.id, entity.merchantAddress, entity.status, entity.verificationTier, entity.createdAt, entity.updatedAt]
    );
    return res.rows[0];
  }

  async delete(id: string, tx?: TransactionContext): Promise<void> {
    await this.client.query('DELETE FROM merchants WHERE id = $1', [id]);
  }

  async exists(id: string, tx?: TransactionContext): Promise<boolean> {
    const res = await this.client.query('SELECT 1 FROM merchants WHERE id = $1', [id]);
    return res.rowCount !== null && res.rowCount > 0;
  }

  async findByAddress(address: string): Promise<MerchantRecord | null> {
    const res = await this.client.query('SELECT * FROM merchants WHERE merchant_address = $1', [address]);
    return res.rows[0] ?? null;
  }

  async findByStatus(status: string): Promise<MerchantRecord[]> {
    const res = await this.client.query('SELECT * FROM merchants WHERE status = $1', [status]);
    return res.rows;
  }
}

export class PostgresLoyaltyRepository implements ILoyaltyRepository {
  constructor(private client: Pool | PoolClient) {}

  async findById(id: string, tx?: TransactionContext): Promise<LoyaltyRecord | null> {
    const res = await this.client.query('SELECT * FROM loyalty WHERE id = $1', [id]);
    return res.rows[0] ?? null;
  }

  async findAll(opts?: QueryOptions, tx?: TransactionContext): Promise<Page<LoyaltyRecord>> {
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 100;
    const res = await this.client.query('SELECT * FROM loyalty LIMIT $1 OFFSET $2', [limit, offset]);
    return paginate(res.rows, opts);
  }

  async save(entity: LoyaltyRecord, tx?: TransactionContext): Promise<LoyaltyRecord> {
    const res = await this.client.query(
      `INSERT INTO loyalty (id, subscriber_id, points, lifetime_points, tier, streak_current, streak_longest, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
       points = $3, lifetime_points = $4, tier = $5, streak_current = $6, streak_longest = $7, updated_at = $8
       RETURNING *`,
      [entity.id, entity.subscriberId, entity.points, entity.lifetimePoints, entity.tier, entity.streakCurrent, entity.streakLongest, entity.updatedAt]
    );
    return res.rows[0];
  }

  async delete(id: string, tx?: TransactionContext): Promise<void> {
    await this.client.query('DELETE FROM loyalty WHERE id = $1', [id]);
  }

  async exists(id: string, tx?: TransactionContext): Promise<boolean> {
    const res = await this.client.query('SELECT 1 FROM loyalty WHERE id = $1', [id]);
    return res.rowCount !== null && res.rowCount > 0;
  }

  async findBySubscriberId(subscriberId: string): Promise<LoyaltyRecord | null> {
    const res = await this.client.query('SELECT * FROM loyalty WHERE subscriber_id = $1', [subscriberId]);
    return res.rows[0] ?? null;
  }

  async findTopByPoints(limit: number): Promise<LoyaltyRecord[]> {
    const res = await this.client.query('SELECT * FROM loyalty ORDER BY points DESC LIMIT $1', [limit]);
    return res.rows;
  }
}

export class PostgresUnitOfWork implements IUnitOfWork {
  public subscriptions: PostgresSubscriptionRepository;
  public transactions: PostgresTransactionRepository;
  public users: PostgresUserRepository;
  public merchants: PostgresMerchantRepository;
  public loyalty: PostgresLoyaltyRepository;

  constructor(private pool: Pool) {
    // Default to pool for non-transactional access
    this.subscriptions = new PostgresSubscriptionRepository(this.pool);
    this.transactions = new PostgresTransactionRepository(this.pool);
    this.users = new PostgresUserRepository(this.pool);
    this.merchants = new PostgresMerchantRepository(this.pool);
    this.loyalty = new PostgresLoyaltyRepository(this.pool);
  }

  async run<T>(work: (uow: IUnitOfWork) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const uow = new PostgresUnitOfWork(this.pool);
      uow.subscriptions = new PostgresSubscriptionRepository(client);
      uow.transactions = new PostgresTransactionRepository(client);
      uow.users = new PostgresUserRepository(client);
      uow.merchants = new PostgresMerchantRepository(client);
      uow.loyalty = new PostgresLoyaltyRepository(client);
      
      const result = await work(uow);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
