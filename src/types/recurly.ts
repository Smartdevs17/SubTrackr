/**
 * Recurly migration importer types
 * Models Recurly's subscription billing data structures for migration to SubTrackr.
 */

// ─── Enums / unions ───────────────────────────────────────────────────────────

export type RecurlySubscriptionState =
  | 'active'
  | 'canceled'
  | 'expired'
  | 'future'
  | 'paused'
  | 'failed';

export type RecurlyAccountState = 'active' | 'closed';

export type RecurlyInvoiceState =
  | 'pending'
  | 'processing'
  | 'past_due'
  | 'paid'
  | 'failed'
  | 'open';

export type RecurlyIntervalUnit = 'days' | 'months';

// ─── Plan ─────────────────────────────────────────────────────────────────────

export interface RecurlyPlan {
  /** Recurly plan code (unique identifier) */
  code: string;
  name: string;
  description?: string;
  /** Price in minor currency units (cents) */
  unit_amount_in_cents: number;
  currency: string;
  plan_interval_length: number;
  plan_interval_unit: RecurlyIntervalUnit;
  trial_interval_length?: number;
  trial_interval_unit?: RecurlyIntervalUnit;
  /** Whether the plan is still available */
  state: 'active' | 'inactive';
  created_at: string; // ISO 8601
  updated_at: string;
}

// ─── Account ──────────────────────────────────────────────────────────────────

export interface RecurlyAccount {
  /** Recurly account code */
  account_code: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  state: RecurlyAccountState;
  created_at: string;
  updated_at: string;
}

// ─── Add-on ───────────────────────────────────────────────────────────────────

export interface RecurlyAddon {
  add_on_code: string;
  name: string;
  unit_amount_in_cents: number;
  currency: string;
  quantity?: number;
}

// ─── Subscription ─────────────────────────────────────────────────────────────

export interface RecurlySubscription {
  uuid: string;
  account: Pick<RecurlyAccount, 'account_code' | 'email'>;
  plan: Pick<RecurlyPlan, 'code' | 'name' | 'plan_interval_length' | 'plan_interval_unit'>;
  state: RecurlySubscriptionState;
  unit_amount_in_cents: number;
  currency: string;
  quantity: number;
  activated_at?: string;
  canceled_at?: string;
  expires_at?: string;
  current_period_started_at?: string;
  current_period_ends_at?: string;
  trial_started_at?: string;
  trial_ends_at?: string;
  paused_at?: string;
  resume_at?: string;
  add_ons?: RecurlyAddon[];
  created_at: string;
  updated_at: string;
}

// ─── Invoice ──────────────────────────────────────────────────────────────────

export interface RecurlyInvoice {
  invoice_number: string;
  account: Pick<RecurlyAccount, 'account_code'>;
  state: RecurlyInvoiceState;
  subtotal_in_cents: number;
  tax_in_cents: number;
  total_in_cents: number;
  currency: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
}

// ─── Migration types ──────────────────────────────────────────────────────────

export interface ImportedSubscription {
  id: string;
  recurlyUuid: string;
  accountCode: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  billingCycle: 'monthly' | 'yearly' | 'weekly' | 'custom';
  customCycleDays?: number;
  isActive: boolean;
  isPaused: boolean;
  isCryptoEnabled: false;
  trialDays?: number;
  nextBillingDate?: Date;
  addons: Array<{ code: string; name: string; price: number; quantity: number }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MigrationReport {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  subscriptions: ImportedSubscription[];
  errors: Array<{ recurlyUuid: string; reason: string }>;
  skippedIds: string[];
  startedAt: Date;
  completedAt: Date;
}

export interface RecurlyImporterOptions {
  /** Skip subscriptions in these states */
  skipStates?: RecurlySubscriptionState[];
  /** Currency to fall back to when subscription has none */
  defaultCurrency?: string;
  /** Plans registry for name resolution (code → plan) */
  plansRegistry?: Map<string, RecurlyPlan>;
  /** Batch size for processing */
  batchSize?: number;
}
