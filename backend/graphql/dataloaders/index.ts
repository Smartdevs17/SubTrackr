/**
 * DataLoader factory functions
 *
 * Each loader batches IDs and issues a single SQL query per tick,
 * preventing N+1 query problems in nested GraphQL resolvers.
 *
 * Acceptance criteria:
 *   - Batch loaders for Subscription, Transaction, PaymentMethod, Plan
 *   - A list query for 1000 subscriptions uses <5 connections
 */

import { Pool } from '../../shared/db/connectionPool';

// ── Minimal DataLoader-compatible interface ───────────────────────────────────
// Install: npm i dataloader @types/dataloader

export interface IDataLoader<K, V> {
  load(key: K): Promise<V | null>;
  loadMany(keys: K[]): Promise<Array<V | null | Error>>;
  clear(key: K): void;
  clearAll(): void;
  prime(key: K, value: V): void;
}

// ── Subscription DataLoader ───────────────────────────────────────────────────

export interface SubscriptionRow {
  id: string;
  userId: string;
  name: string;
  amount: number;
  currency: string;
  billingCycle: string;
  status: string;
  nextBillingDate: string;
  createdAt: string;
  updatedAt: string;
}

export async function createSubscriptionLoader(
  pool: Pool,
): Promise<IDataLoader<string, SubscriptionRow>> {
  const { default: DataLoader } = await import('dataloader') as {
    default: new <K, V>(fn: (keys: readonly K[]) => Promise<Array<V | Error | null>>) => IDataLoader<K, V>;
  };

  return new DataLoader<string, SubscriptionRow>(async (ids) => {
    const result = await pool.query<SubscriptionRow>(
      `SELECT id, user_id AS "userId", name, amount, currency,
              billing_cycle AS "billingCycle", status,
              next_billing_date AS "nextBillingDate",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM subscriptions
       WHERE id = ANY($1::text[])`,
      [ids as string[]],
    );
    const byId = new Map(result.rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id) ?? null);
  });
}

// ── Transaction DataLoader ────────────────────────────────────────────────────

export interface TransactionRow {
  id: string;
  subscriptionId: string;
  userId: string;
  amount: number;
  currency: string;
  status: string;
  timestamp: string;
  txHash: string | null;
}

export async function createTransactionLoader(
  pool: Pool,
): Promise<IDataLoader<string, TransactionRow>> {
  const { default: DataLoader } = await import('dataloader') as {
    default: new <K, V>(fn: (keys: readonly K[]) => Promise<Array<V | Error | null>>) => IDataLoader<K, V>;
  };

  return new DataLoader<string, TransactionRow>(async (ids) => {
    const result = await pool.query<TransactionRow>(
      `SELECT id,
              subscription_id AS "subscriptionId",
              user_id         AS "userId",
              amount, currency, status, timestamp,
              tx_hash         AS "txHash"
       FROM transactions
       WHERE id = ANY($1::text[])`,
      [ids as string[]],
    );
    const byId = new Map(result.rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id) ?? null);
  });
}

// ── PaymentMethod DataLoader ──────────────────────────────────────────────────

export interface PaymentMethodRow {
  id: string;
  userId: string;
  type: string;
  last4: string | null;
  brand: string | null;
  expiresAt: string | null;
}

export async function createPaymentMethodLoader(
  pool: Pool,
): Promise<IDataLoader<string, PaymentMethodRow>> {
  const { default: DataLoader } = await import('dataloader') as {
    default: new <K, V>(fn: (keys: readonly K[]) => Promise<Array<V | Error | null>>) => IDataLoader<K, V>;
  };

  return new DataLoader<string, PaymentMethodRow>(async (ids) => {
    const result = await pool.query<PaymentMethodRow>(
      `SELECT id,
              user_id    AS "userId",
              type, last4, brand,
              expires_at AS "expiresAt"
       FROM payment_methods
       WHERE id = ANY($1::text[])`,
      [ids as string[]],
    );
    const byId = new Map(result.rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id) ?? null);
  });
}

// ── Plan DataLoader ───────────────────────────────────────────────────────────

export interface PlanRow {
  id: string;
  name: string;
  price: number;
  currency: string;
  billingCycle: string;
}

export async function createPlanLoader(pool: Pool): Promise<IDataLoader<string, PlanRow>> {
  const { default: DataLoader } = await import('dataloader') as {
    default: new <K, V>(fn: (keys: readonly K[]) => Promise<Array<V | Error | null>>) => IDataLoader<K, V>;
  };

  return new DataLoader<string, PlanRow>(async (ids) => {
    const result = await pool.query<PlanRow>(
      `SELECT id, name, price, currency, billing_cycle AS "billingCycle"
       FROM plans
       WHERE id = ANY($1::text[])`,
      [ids as string[]],
    );
    const byId = new Map(result.rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id) ?? null);
  });
}

// ── Invoice DataLoader ────────────────────────────────────────────────────────

export interface InvoiceRow {
  id: string;
  subscriptionId: string;
  userId: string;
  amount: number;
  currency: string;
  status: string;
  issuedAt: string;
  dueAt: string | null;
  paidAt: string | null;
}

export async function createInvoiceLoader(pool: Pool): Promise<IDataLoader<string, InvoiceRow>> {
  const { default: DataLoader } = await import('dataloader') as {
    default: new <K, V>(fn: (keys: readonly K[]) => Promise<Array<V | Error | null>>) => IDataLoader<K, V>;
  };

  return new DataLoader<string, InvoiceRow>(async (ids) => {
    const result = await pool.query<InvoiceRow>(
      `SELECT id,
              subscription_id AS "subscriptionId",
              user_id         AS "userId",
              amount, currency, status,
              issued_at       AS "issuedAt",
              due_at          AS "dueAt",
              paid_at         AS "paidAt"
       FROM invoices
       WHERE id = ANY($1::text[])`,
      [ids as string[]],
    );
    const byId = new Map(result.rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id) ?? null);
  });
}

// ── Context factory ───────────────────────────────────────────────────────────

export interface DataLoaderContext {
  subscriptionLoader: IDataLoader<string, SubscriptionRow>;
  transactionLoader: IDataLoader<string, TransactionRow>;
  paymentMethodLoader: IDataLoader<string, PaymentMethodRow>;
  planLoader: IDataLoader<string, PlanRow>;
  invoiceLoader: IDataLoader<string, InvoiceRow>;
}

export async function createLoaderContext(pool: Pool): Promise<DataLoaderContext> {
  const [subscriptionLoader, transactionLoader, paymentMethodLoader, planLoader, invoiceLoader] =
    await Promise.all([
      createSubscriptionLoader(pool),
      createTransactionLoader(pool),
      createPaymentMethodLoader(pool),
      createPlanLoader(pool),
      createInvoiceLoader(pool),
    ]);

  return { subscriptionLoader, transactionLoader, paymentMethodLoader, planLoader, invoiceLoader };
}
