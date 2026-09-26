/**
 * Repository interfaces for all data stores.
 * Issue #405: Refactor service layer to use repository pattern.
 */

// ── Core types ────────────────────────────────────────────────────────────────

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface QueryOptions {
  offset?: number;
  limit?: number;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
}

export interface TransactionContext {
  id: string;
}

// ── Base repository ───────────────────────────────────────────────────────────

export interface IRepository<T, ID = string> {
  findById(id: ID, tx?: TransactionContext): Promise<T | null>;
  findAll(opts?: QueryOptions, tx?: TransactionContext): Promise<Page<T>>;
  save(entity: T, tx?: TransactionContext): Promise<T>;
  delete(id: ID, tx?: TransactionContext): Promise<void>;
  exists(id: ID, tx?: TransactionContext): Promise<boolean>;
}

// ── Domain types (minimal, matching existing store shapes) ────────────────────

export interface Subscription {
  id: string;
  userId: string;
  name: string;
  amount: number;
  currency: string;
  billingCycle: string;
  status: 'active' | 'paused' | 'cancelled';
  nextBillingDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Transaction {
  id: string;
  subscriptionId: string;
  userId: string;
  amount: number;
  currency: string;
  status: 'success' | 'failed' | 'pending';
  timestamp: Date;
  txHash?: string;
}

export interface User {
  id: string;
  address: string;
  email?: string;
  createdAt: Date;
}

export interface MerchantRecord {
  id: string;
  merchantAddress: string;
  status: string;
  verificationTier?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoyaltyRecord {
  id: string;
  subscriberId: string;
  points: number;
  lifetimePoints: number;
  tier: string;
  streakCurrent: number;
  streakLongest: number;
  updatedAt: Date;
}

// ── Domain-specific repository interfaces ─────────────────────────────────────

export interface ISubscriptionRepository extends IRepository<Subscription> {
  findByUserId(userId: string, opts?: QueryOptions): Promise<Page<Subscription>>;
  findByStatus(status: Subscription['status'], opts?: QueryOptions): Promise<Page<Subscription>>;
  findDueBefore(date: Date): Promise<Subscription[]>;
}

export interface ITransactionRepository extends IRepository<Transaction> {
  findBySubscriptionId(subscriptionId: string, opts?: QueryOptions): Promise<Page<Transaction>>;
  findByUserId(userId: string, opts?: QueryOptions): Promise<Page<Transaction>>;
  findByStatus(status: Transaction['status']): Promise<Transaction[]>;
}

export interface IUserRepository extends IRepository<User> {
  findByAddress(address: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
}

export interface IMerchantRepository extends IRepository<MerchantRecord> {
  findByAddress(address: string): Promise<MerchantRecord | null>;
  findByStatus(status: string): Promise<MerchantRecord[]>;
}

export interface ILoyaltyRepository extends IRepository<LoyaltyRecord> {
  findBySubscriberId(subscriberId: string): Promise<LoyaltyRecord | null>;
  findTopByPoints(limit: number): Promise<LoyaltyRecord[]>;
}

// ── Unit-of-work / transaction manager ───────────────────────────────────────

export interface IUnitOfWork {
  subscriptions: ISubscriptionRepository;
  transactions: ITransactionRepository;
  users: IUserRepository;
  merchants: IMerchantRepository;
  loyalty: ILoyaltyRepository;

  /** Run a set of operations atomically. Rolls back on error. */
  run<T>(work: (uow: IUnitOfWork) => Promise<T>): Promise<T>;
}
