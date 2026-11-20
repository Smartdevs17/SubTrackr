/**
 * TypeScript mirror of the Soroban contract types in
 * `contracts/types/src/lib.rs`.
 *
 * This is the single definition TS clients (the JS SDK, the app, the backend)
 * use for on-chain enums and structs. `__tests__/contract.test.ts` parses the
 * Rust source and fails if the two drift apart.
 *
 * Addresses are Stellar strkeys. `u64` timestamps are Unix seconds and `i128`
 * amounts are in the token's smallest unit (stroops for XLM); both are carried
 * as `number` over the JSON API.
 */

/** Mirrors `enum Interval`. */
export const INTERVALS = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly'] as const;
export type Interval = (typeof INTERVALS)[number];

/** Mirrors `Interval::seconds()`. */
export const INTERVAL_SECONDS: Readonly<Record<Interval, number>> = Object.freeze({
  Daily: 86_400,
  Weekly: 604_800,
  Monthly: 2_592_000,
  Quarterly: 7_776_000,
  Yearly: 31_536_000,
});

/** Mirrors `enum SubscriptionStatus`. */
export const SUBSCRIPTION_STATUSES = ['Active', 'Paused', 'Cancelled', 'PastDue'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Mirrors `struct Plan`. */
export interface Plan {
  id: number;
  merchant: string;
  name: string;
  price: number;
  token: string;
  interval: Interval;
  active: boolean;
  subscriber_count: number;
  created_at: number;
}

/** Mirrors `struct Subscription`. */
export interface Subscription {
  id: number;
  plan_id: number;
  subscriber: string;
  status: SubscriptionStatus;
  started_at: number;
  last_charged_at: number;
  next_charge_at: number;
  total_paid: number;
  total_gas_spent: number;
  charge_count: number;
  paused_at: number;
  pause_duration: number;
  refund_requested_amount: number;
}

export function isInterval(value: unknown): value is Interval {
  return typeof value === 'string' && (INTERVALS as readonly string[]).includes(value);
}

export function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return typeof value === 'string' && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

/** Length of one billing period in seconds, matching the contract. */
export function intervalSeconds(interval: Interval): number {
  const seconds = INTERVAL_SECONDS[interval];
  if (seconds === undefined) {
    throw new RangeError(`Unknown billing interval: ${String(interval)}`);
  }
  return seconds;
}
