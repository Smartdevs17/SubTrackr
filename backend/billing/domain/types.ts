export interface Amount {
  value: number;
  currency: string;
}

export interface BillingUsage {
  units?: number;
  seats?: number;
  metadata?: Record<string, unknown>;
}

export interface BillingPlan {
  typeCode: string;
  price: number;
  currency: string;
  usageUnitPrice?: number;
  seatCount?: number;
  tiers?: PricingTier[];
  metadata?: Record<string, unknown>;
}

export interface BillingSubscriber {
  id: string;
  seatCount?: number;
  seats?: number;
  metadata?: Record<string, unknown>;
}

export interface PricingTier {
  upTo: number | null;
  unitPrice: number;
}

export type PricingStrategyCode = string;

export const createAmount = (value: number, currency: string): Amount => ({
  value: Number.isFinite(value) ? Number(value.toFixed(2)) : 0,
  currency,
});

export const getBillingQuantity = (
  usage: BillingUsage,
  plan: BillingPlan,
  subscriber: BillingSubscriber
): number => {
  const quantity = usage.seats ?? subscriber.seats ?? subscriber.seatCount ?? plan.seatCount ?? usage.units ?? 1;
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
};

export const getUsageUnits = (usage: BillingUsage): number => {
  const units = usage.units ?? 0;
  return Number.isFinite(units) && units > 0 ? units : 0;
};
