import {
  ResellerTier,
  MarketplaceListing,
  ResellerOrder,
  ResellerMetrics,
  CreateListingInput,
  PlaceOrderInput,
  OrderStatus,
  ListingStatus,
} from '../types/reseller';

/** Default wholesale discount rates per tier */
export const TIER_DISCOUNT_RATES: Record<ResellerTier, number> = {
  [ResellerTier.BRONZE]: 10,
  [ResellerTier.SILVER]: 15,
  [ResellerTier.GOLD]: 25,
  [ResellerTier.PLATINUM]: 35,
};

/** Default commission rates per tier */
export const TIER_COMMISSION_RATES: Record<ResellerTier, number> = {
  [ResellerTier.BRONZE]: 5,
  [ResellerTier.SILVER]: 10,
  [ResellerTier.GOLD]: 15,
  [ResellerTier.PLATINUM]: 20,
};

/**
 * Calculates wholesale price given a retail price and discount percentage.
 */
export function calculateWholesalePrice(retailPrice: number, discountPercentage: number): number {
  if (retailPrice < 0) return 0;
  if (discountPercentage <= 0) return retailPrice;
  if (discountPercentage >= 100) return 0;
  const wholesale = retailPrice * (1 - discountPercentage / 100);
  return Math.round(wholesale * 100) / 100;
}

/**
 * Calculates net commission earned by a reseller on an order.
 */
export function calculateCommission(retailTotal: number, wholesaleTotal: number): number {
  if (retailTotal <= 0 || wholesaleTotal < 0) return 0;
  const margin = retailTotal - wholesaleTotal;
  return Math.max(0, Math.round(margin * 100) / 100);
}

/**
 * Gets default discount rate for a reseller tier.
 */
export function getTierDiscount(tier: ResellerTier): number {
  return TIER_DISCOUNT_RATES[tier] ?? 10;
}

/**
 * Gets default commission rate for a reseller tier.
 */
export function getTierCommissionRate(tier: ResellerTier): number {
  return TIER_COMMISSION_RATES[tier] ?? 5;
}

/**
 * Validates input for creating a marketplace listing.
 */
export function validateListingInput(data: Partial<CreateListingInput>): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!data.resellerId || !data.resellerId.trim()) {
    errors.push('Reseller ID is required');
  }
  if (!data.title || !data.title.trim()) {
    errors.push('Listing title is required');
  }
  if (!data.description || !data.description.trim()) {
    errors.push('Listing description is required');
  }
  if (
    data.retailPrice === undefined ||
    data.retailPrice === null ||
    Number.isNaN(data.retailPrice) ||
    data.retailPrice <= 0
  ) {
    errors.push('Retail price must be greater than 0');
  }
  if (!data.category) {
    errors.push('Subscription category is required');
  }
  if (!data.billingCycle) {
    errors.push('Billing cycle is required');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validates input for placing a reseller order.
 */
export function validateOrderInput(data: Partial<PlaceOrderInput>): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!data.resellerId || !data.resellerId.trim()) {
    errors.push('Reseller ID is required');
  }
  if (!data.listingId || !data.listingId.trim()) {
    errors.push('Listing ID is required');
  }
  if (!data.customerName || !data.customerName.trim()) {
    errors.push('Customer name is required');
  }
  if (!data.customerEmail || !data.customerEmail.trim() || !data.customerEmail.includes('@')) {
    errors.push('Valid customer email is required');
  }
  if (data.quantity !== undefined && (data.quantity <= 0 || !Number.isInteger(data.quantity))) {
    errors.push('Quantity must be a positive integer');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Computes performance metrics for a reseller.
 */
export function computeResellerMetrics(
  orders: ResellerOrder[],
  listings: MarketplaceListing[],
  resellerId: string
): ResellerMetrics {
  const resellerOrders = orders.filter(
    (o) => o.resellerId === resellerId && o.status === OrderStatus.COMPLETED
  );
  const activeListings = listings.filter(
    (l) => l.resellerId === resellerId && l.status === ListingStatus.PUBLISHED
  );

  let grossRevenue = 0;
  let wholesaleCost = 0;
  let netCommissionEarned = 0;

  for (const order of resellerOrders) {
    grossRevenue += order.retailTotal;
    wholesaleCost += order.wholesaleTotal;
    netCommissionEarned += order.commissionEarned;
  }

  return {
    totalSalesCount: resellerOrders.length,
    grossRevenue: Math.round(grossRevenue * 100) / 100,
    wholesaleCost: Math.round(wholesaleCost * 100) / 100,
    netCommissionEarned: Math.round(netCommissionEarned * 100) / 100,
    activeListingsCount: activeListings.length,
  };
}
