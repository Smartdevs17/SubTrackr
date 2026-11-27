/**
 * Data mapper layer for the repository abstraction.
 *
 * Issue #2215: Implement repository abstraction layer for database isolation.
 *
 * A data mapper separates the concern of converting between domain entities
 * and storage rows (SQL result rows, JSON documents, etc.) from the
 * repository itself. This lets repositories stay focused on query
 * construction while the mapper handles serialization/deserialization, and
 * makes it straightforward to swap storage backends (Postgres, Redis, a
 * flat-file store) without touching the repository logic.
 *
 * ## Architecture
 *
 * ```
 *   Domain Entity  ──▶  DataMapper  ──▶  Storage Row
 *        ▲                                   │
 *        └──────────  DataMapper  ◀──────────┘
 * ```
 *
 * Each domain entity has a dedicated mapper implementing `IDataMapper<E, R>`.
 * The mappers are pure functions — no I/O, no side effects — which makes them
 * trivially testable and safe to reuse across repository implementations.
 */

import type {
  Subscription,
  Transaction,
  User,
  MerchantRecord,
  LoyaltyRecord,
} from './interfaces';

// ── Mapper interface ─────────────────────────────────────────────────────────

/**
 * Maps between a domain entity `E` and a storage row `R`.
 *
 * `toRow` converts an entity into the shape a storage backend expects
 * (camelCase → snake_case for Postgres, plain JSON for document stores).
 * `toEntity` converts a raw row back into a domain entity, normalising types
 * (e.g. converting a string ISO date from the DB into a Date object).
 */
export interface IDataMapper<E, R = Record<string, unknown>> {
  toRow(entity: E): R;
  toEntity(row: R): E;
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return new Date();
}

// ── Subscription mapper ───────────────────────────────────────────────────────

export interface SubscriptionRow {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  currency: string;
  billing_cycle: string;
  status: string;
  next_billing_date: unknown;
  created_at: unknown;
  updated_at: unknown;
}

export class SubscriptionDataMapper implements IDataMapper<Subscription, SubscriptionRow> {
  toRow(entity: Subscription): SubscriptionRow {
    return {
      id: entity.id,
      user_id: entity.userId,
      name: entity.name,
      amount: entity.amount,
      currency: entity.currency,
      billing_cycle: entity.billingCycle,
      status: entity.status,
      next_billing_date: entity.nextBillingDate,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt,
    };
  }

  toEntity(row: SubscriptionRow): Subscription {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      amount: row.amount,
      currency: row.currency,
      billingCycle: row.billing_cycle,
      status: row.status as Subscription['status'],
      nextBillingDate: toDate(row.next_billing_date),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }
}

// ── Transaction mapper ───────────────────────────────────────────────────────

export interface TransactionRow {
  id: string;
  subscription_id: string;
  user_id: string;
  amount: number;
  currency: string;
  status: string;
  timestamp: unknown;
  tx_hash: string | null;
}

export class TransactionDataMapper implements IDataMapper<Transaction, TransactionRow> {
  toRow(entity: Transaction): TransactionRow {
    return {
      id: entity.id,
      subscription_id: entity.subscriptionId,
      user_id: entity.userId,
      amount: entity.amount,
      currency: entity.currency,
      status: entity.status,
      timestamp: entity.timestamp,
      tx_hash: entity.txHash ?? null,
    };
  }

  toEntity(row: TransactionRow): Transaction {
    return {
      id: row.id,
      subscriptionId: row.subscription_id,
      userId: row.user_id,
      amount: row.amount,
      currency: row.currency,
      status: row.status as Transaction['status'],
      timestamp: toDate(row.timestamp),
      txHash: row.tx_hash ?? undefined,
    };
  }
}

// ── User mapper ──────────────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  address: string;
  email: string | null;
  created_at: unknown;
}

export class UserDataMapper implements IDataMapper<User, UserRow> {
  toRow(entity: User): UserRow {
    return {
      id: entity.id,
      address: entity.address,
      email: entity.email ?? null,
      created_at: entity.createdAt,
    };
  }

  toEntity(row: UserRow): User {
    return {
      id: row.id,
      address: row.address,
      email: row.email ?? undefined,
      createdAt: toDate(row.created_at),
    };
  }
}

// ── Merchant mapper ──────────────────────────────────────────────────────────

export interface MerchantRow {
  id: string;
  merchant_address: string;
  status: string;
  verification_tier: string | null;
  created_at: unknown;
  updated_at: unknown;
}

export class MerchantDataMapper implements IDataMapper<MerchantRecord, MerchantRow> {
  toRow(entity: MerchantRecord): MerchantRow {
    return {
      id: entity.id,
      merchant_address: entity.merchantAddress,
      status: entity.status,
      verification_tier: entity.verificationTier ?? null,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt,
    };
  }

  toEntity(row: MerchantRow): MerchantRecord {
    return {
      id: row.id,
      merchantAddress: row.merchant_address,
      status: row.status,
      verificationTier: row.verification_tier ?? undefined,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }
}

// ── Loyalty mapper ────────────────────────────────────────────────────────────

export interface LoyaltyRow {
  id: string;
  subscriber_id: string;
  points: number;
  lifetime_points: number;
  tier: string;
  streak_current: number;
  streak_longest: number;
  updated_at: unknown;
}

export class LoyaltyDataMapper implements IDataMapper<LoyaltyRecord, LoyaltyRow> {
  toRow(entity: LoyaltyRecord): LoyaltyRow {
    return {
      id: entity.id,
      subscriber_id: entity.subscriberId,
      points: entity.points,
      lifetime_points: entity.lifetimePoints,
      tier: entity.tier,
      streak_current: entity.streakCurrent,
      streak_longest: entity.streakLongest,
      updated_at: entity.updatedAt,
    };
  }

  toEntity(row: LoyaltyRow): LoyaltyRecord {
    return {
      id: row.id,
      subscriberId: row.subscriber_id,
      points: row.points,
      lifetimePoints: row.lifetime_points,
      tier: row.tier,
      streakCurrent: row.streak_current,
      streakLongest: row.streak_longest,
      updatedAt: toDate(row.updated_at),
    };
  }
}

// ── Mapper registry ───────────────────────────────────────────────────────────

/**
 * Central registry of all data mappers. Repositories can look up the
 * mapper for their entity type instead of hardcoding the conversion logic.
 */
export class DataMapperRegistry {
  private mappers = new Map<string, IDataMapper<unknown, unknown>>();

  constructor() {
    this.register('subscription', new SubscriptionDataMapper());
    this.register('transaction', new TransactionDataMapper());
    this.register('user', new UserDataMapper());
    this.register('merchant', new MerchantDataMapper());
    this.register('loyalty', new LoyaltyDataMapper());
  }

  register<E, R>(name: string, mapper: IDataMapper<E, R>): void {
    this.mappers.set(name, mapper as IDataMapper<unknown, unknown>);
  }

  get<E, R>(name: string): IDataMapper<E, R> {
    const mapper = this.mappers.get(name);
    if (!mapper) throw new Error(`No data mapper registered for "${name}"`);
    return mapper as IDataMapper<E, R>;
  }

  has(name: string): boolean {
    return this.mappers.has(name);
  }

  list(): string[] {
    return [...this.mappers.keys()];
  }
}

export const dataMapperRegistry = new DataMapperRegistry();
