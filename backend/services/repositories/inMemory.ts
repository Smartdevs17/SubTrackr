/**
 * In-memory repository implementations — used for testing and local dev.
 * Issue #405: Repository pattern.
 */

import {
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

// ── Generic in-memory base ────────────────────────────────────────────────────

class InMemoryRepository<T extends { id: string }> implements IRepository<T> {
  protected store = new Map<string, T>();

  async findById(id: string): Promise<T | null> {
    return this.store.get(id) ?? null;
  }

  async findAll(opts: QueryOptions = {}): Promise<Page<T>> {
    const all = [...this.store.values()];
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? all.length;
    const items = all.slice(offset, offset + limit);
    return { items, total: all.length, offset, limit };
  }

  async save(entity: T): Promise<T> {
    this.store.set(entity.id, { ...entity });
    return entity;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async exists(id: string): Promise<boolean> {
    return this.store.has(id);
  }

  /** Test helper: clear all records. */
  clear(): void {
    this.store.clear();
  }

  /** Test helper: seed records. */
  seed(records: T[]): void {
    records.forEach((r) => this.store.set(r.id, r));
  }
}

// ── Subscription repository ───────────────────────────────────────────────────

export class InMemorySubscriptionRepository
  extends InMemoryRepository<Subscription>
  implements ISubscriptionRepository
{
  async findByUserId(userId: string, opts: QueryOptions = {}): Promise<Page<Subscription>> {
    const filtered = [...this.store.values()].filter((s) => s.userId === userId);
    return paginate(filtered, opts);
  }

  async findByStatus(status: Subscription['status'], opts: QueryOptions = {}): Promise<Page<Subscription>> {
    const filtered = [...this.store.values()].filter((s) => s.status === status);
    return paginate(filtered, opts);
  }

  async findDueBefore(date: Date): Promise<Subscription[]> {
    return [...this.store.values()].filter(
      (s) => s.status === 'active' && s.nextBillingDate <= date,
    );
  }
}

// ── Transaction repository ────────────────────────────────────────────────────

export class InMemoryTransactionRepository
  extends InMemoryRepository<Transaction>
  implements ITransactionRepository
{
  async findBySubscriptionId(subscriptionId: string, opts: QueryOptions = {}): Promise<Page<Transaction>> {
    const filtered = [...this.store.values()].filter((t) => t.subscriptionId === subscriptionId);
    return paginate(filtered, opts);
  }

  async findByUserId(userId: string, opts: QueryOptions = {}): Promise<Page<Transaction>> {
    const filtered = [...this.store.values()].filter((t) => t.userId === userId);
    return paginate(filtered, opts);
  }

  async findByStatus(status: Transaction['status']): Promise<Transaction[]> {
    return [...this.store.values()].filter((t) => t.status === status);
  }
}

// ── User repository ───────────────────────────────────────────────────────────

export class InMemoryUserRepository
  extends InMemoryRepository<User>
  implements IUserRepository
{
  async findByAddress(address: string): Promise<User | null> {
    return [...this.store.values()].find((u) => u.address === address) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    return [...this.store.values()].find((u) => u.email === email) ?? null;
  }
}

// ── Merchant repository ───────────────────────────────────────────────────────

export class InMemoryMerchantRepository
  extends InMemoryRepository<MerchantRecord>
  implements IMerchantRepository
{
  async findByAddress(address: string): Promise<MerchantRecord | null> {
    return [...this.store.values()].find((m) => m.merchantAddress === address) ?? null;
  }

  async findByStatus(status: string): Promise<MerchantRecord[]> {
    return [...this.store.values()].filter((m) => m.status === status);
  }
}

// ── Loyalty repository ────────────────────────────────────────────────────────

export class InMemoryLoyaltyRepository
  extends InMemoryRepository<LoyaltyRecord>
  implements ILoyaltyRepository
{
  async findBySubscriberId(subscriberId: string): Promise<LoyaltyRecord | null> {
    return [...this.store.values()].find((l) => l.subscriberId === subscriberId) ?? null;
  }

  async findTopByPoints(limit: number): Promise<LoyaltyRecord[]> {
    return [...this.store.values()]
      .sort((a, b) => b.points - a.points)
      .slice(0, limit);
  }
}

// ── In-memory unit of work ────────────────────────────────────────────────────

export class InMemoryUnitOfWork implements IUnitOfWork {
  subscriptions = new InMemorySubscriptionRepository();
  transactions = new InMemoryTransactionRepository();
  users = new InMemoryUserRepository();
  merchants = new InMemoryMerchantRepository();
  loyalty = new InMemoryLoyaltyRepository();

  async run<T>(work: (uow: IUnitOfWork) => Promise<T>): Promise<T> {
    // In-memory: no real transaction isolation needed; just execute.
    return work(this);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function paginate<T>(items: T[], opts: QueryOptions): Page<T> {
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? items.length;
  return { items: items.slice(offset, offset + limit), total: items.length, offset, limit };
}
