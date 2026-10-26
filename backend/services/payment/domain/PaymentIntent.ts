/**
 * Payment intent domain model and repository.
 * Represents a payment's lifecycle from creation to finality/expiry.
 */

export type PaymentIntentStatus =
  | 'created'
  | 'awaiting_signature'
  | 'submitted'
  | 'pending_finality'
  | 'finalized'
  | 'failed'
  | 'expired'
  | 'cancelled';

export type PaymentChain = 'stellar' | 'evm' | 'fiat';

export interface PaymentIntent {
  id: string;
  merchantId: string;
  subscriberId: string;
  subscriptionId?: string;
  amount: string | number;
  asset: string;
  issuer?: string;
  chain: PaymentChain;
  status: PaymentIntentStatus;
  unsignedXdr?: string;
  signedXdr?: string;
  txHash?: string;
  requiredConfirmations: number;
  confirmations: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, any>;
  webhookDeliveryIds: string[];
}

export interface PaymentIntentCreateInput {
  merchantId: string;
  subscriberId: string;
  subscriptionId?: string;
  amount: string | number;
  asset: string;
  issuer?: string;
  chain: PaymentChain;
  unsignedXdr?: string;
  requiredConfirmations?: number;
  expiresAt?: number;
  ttlSeconds?: number;
  metadata?: Record<string, any>;
}

export interface PaymentIntentRepository {
  create(intent: PaymentIntent): Promise<PaymentIntent>;
  get(id: string): Promise<PaymentIntent | null>;
  update(id: string, updates: Partial<PaymentIntent>): Promise<PaymentIntent>;
  findByTxHash(txHash: string): Promise<PaymentIntent | null>;
  findOverdue(now: number, statuses: PaymentIntentStatus[]): Promise<PaymentIntent[]>;
  findByStatus(statuses: PaymentIntentStatus[]): Promise<PaymentIntent[]>;
  delete(id: string): Promise<void>;
}

export class InMemoryPaymentIntentRepository implements PaymentIntentRepository {
  private intents = new Map<string, PaymentIntent>();

  async create(intent: PaymentIntent): Promise<PaymentIntent> {
    this.intents.set(intent.id, { ...intent });
    return { ...intent };
  }

  async get(id: string): Promise<PaymentIntent | null> {
    const intent = this.intents.get(id);
    if (!intent) return null;
    return { ...intent };
  }

  async update(id: string, updates: Partial<PaymentIntent>): Promise<PaymentIntent> {
    const existing = this.intents.get(id);
    if (!existing) {
      throw new Error(`PaymentIntent ${id} not found`);
    }
    const updated = { ...existing, ...updates, updatedAt: Date.now() };
    this.intents.set(id, updated);
    return { ...updated };
  }

  async findByTxHash(txHash: string): Promise<PaymentIntent | null> {
    for (const intent of this.intents.values()) {
      if (intent.txHash === txHash) {
        return { ...intent };
      }
    }
    return null;
  }

  async findOverdue(now: number, statuses: PaymentIntentStatus[]): Promise<PaymentIntent[]> {
    const results: PaymentIntent[] = [];
    const statusSet = new Set(statuses);
    for (const intent of this.intents.values()) {
      if (statusSet.has(intent.status) && intent.expiresAt < now) {
        results.push({ ...intent });
      }
    }
    return results;
  }

  async findByStatus(statuses: PaymentIntentStatus[]): Promise<PaymentIntent[]> {
    const results: PaymentIntent[] = [];
    const statusSet = new Set(statuses);
    for (const intent of this.intents.values()) {
      if (statusSet.has(intent.status)) {
        results.push({ ...intent });
      }
    }
    return results;
  }

  async delete(id: string): Promise<void> {
    this.intents.delete(id);
  }
}

let defaultRepo: PaymentIntentRepository | null = null;

export function getDefaultPaymentIntentRepository(): PaymentIntentRepository {
  if (!defaultRepo) {
    defaultRepo = new InMemoryPaymentIntentRepository();
  }
  return defaultRepo;
}

export function setDefaultPaymentIntentRepository(repo: PaymentIntentRepository): void {
  defaultRepo = repo;
}
