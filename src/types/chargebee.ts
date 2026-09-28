/**
 * Chargebee settings mapper types
 * Maps Chargebee plan/subscription configuration to SubTrackr's internal format.
 */

export type ChargbeePeriodUnit = 'day' | 'week' | 'month' | 'year';
export type ChargebeeStatus =
  | 'active'
  | 'cancelled'
  | 'future'
  | 'in_trial'
  | 'non_renewing'
  | 'paused';
export type ChargebeeCurrencyCode = string; // ISO 4217, e.g. "USD", "EUR"

// ─── Plan ────────────────────────────────────────────────────────────────────

export interface ChargbeePlan {
  id: string;
  name: string;
  description?: string;
  price?: number; // in cents
  currency_code: ChargebeeCurrencyCode;
  period: number;
  period_unit: ChargbeePeriodUnit;
  trial_period?: number;
  trial_period_unit?: ChargbeePeriodUnit;
  status: 'active' | 'archived';
  charge_model?: 'flat_fee' | 'per_unit' | 'tiered' | 'volume' | 'stairstep';
  billing_cycles?: number;
  metadata?: Record<string, unknown>;
}

// ─── Addon ───────────────────────────────────────────────────────────────────

export interface ChargebeeAddon {
  id: string;
  name: string;
  price?: number;
  currency_code: ChargebeeCurrencyCode;
  period?: number;
  period_unit?: ChargbeePeriodUnit;
  type: 'on_off' | 'quantity' | 'tiered' | 'volume' | 'stairstep';
}

// ─── Subscription ─────────────────────────────────────────────────────────────

export interface ChargebeeSubscription {
  id: string;
  customer_id: string;
  plan_id: string;
  plan_quantity?: number;
  status: ChargebeeStatus;
  trial_start?: number; // Unix timestamp
  trial_end?: number;
  current_term_start?: number;
  current_term_end?: number;
  next_billing_at?: number;
  created_at: number;
  updated_at: number;
  currency_code: ChargebeeCurrencyCode;
  plan_amount?: number; // in cents
  plan_unit_price?: number;
  billing_period?: number;
  billing_period_unit?: ChargbeePeriodUnit;
  addons?: Array<{ id: string; quantity?: number; unit_price?: number }>;
  metadata?: Record<string, unknown>;
  cancelled_at?: number;
  pause_date?: number;
  resume_date?: number;
}

// ─── Customer ─────────────────────────────────────────────────────────────────

export interface ChargebeeCustomer {
  id: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  created_at: number;
  updated_at: number;
}

// ─── Mapped result ────────────────────────────────────────────────────────────

export interface MappedSubscriptionSettings {
  /** SubTrackr-compatible name */
  name: string;
  description: string;
  /** Price in major currency unit (dollars, euros, etc.) */
  price: number;
  currency: string;
  billingCycle: 'monthly' | 'yearly' | 'weekly' | 'custom';
  /** Number of days for custom billing cycles */
  customCycleDays?: number;
  isActive: boolean;
  isPaused: boolean;
  trialDays?: number;
  nextBillingDate?: Date;
  metadata: Record<string, unknown>;
  addons: Array<{ id: string; name: string; price: number }>;
  /** Original Chargebee IDs for reference */
  sourceIds: { planId: string; subscriptionId?: string };
}

export interface MappedPlanSettings {
  name: string;
  description: string;
  price: number;
  currency: string;
  billingCycle: 'monthly' | 'yearly' | 'weekly' | 'custom';
  customCycleDays?: number;
  trialDays?: number;
  isActive: boolean;
  metadata: Record<string, unknown>;
  addons: Array<{ id: string; name: string; price: number }>;
  sourceIds: { planId: string };
}

// ─── Mapper config ────────────────────────────────────────────────────────────

export interface ChargebeeMapperConfig {
  /** Default currency when plan doesn't specify one */
  defaultCurrency?: string;
  /** Whether to include archived plans */
  includeArchived?: boolean;
  /** Addons registry used to resolve addon names */
  addonsRegistry?: Map<string, ChargebeeAddon>;
}
