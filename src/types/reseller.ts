import { BillingCycle, SubscriptionCategory } from './subscription';

export enum ResellerTier {
  BRONZE = 'bronze',
  SILVER = 'silver',
  GOLD = 'gold',
  PLATINUM = 'platinum',
}

export enum ResellerStatus {
  ACTIVE = 'active',
  PENDING = 'pending',
  SUSPENDED = 'suspended',
  INACTIVE = 'inactive',
}

export enum ListingStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

export enum OrderStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

export interface ResellerBranding {
  companyName?: string;
  logoUrl?: string;
  primaryColor?: string;
  customDomain?: string;
}

export interface Reseller {
  id: string;
  name: string;
  email: string;
  company: string;
  status: ResellerStatus;
  tier: ResellerTier;
  commissionRate: number; // percentage, e.g. 15 for 15%
  wholesaleDiscountPercentage: number; // e.g. 20 for 20% off retail
  balance: number;
  currency: string;
  branding?: ResellerBranding;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketplaceListing {
  id: string;
  resellerId: string;
  title: string;
  description: string;
  category: SubscriptionCategory;
  wholesalePrice: number;
  retailPrice: number;
  suggestedRetailPrice?: number;
  billingCycle: BillingCycle;
  currency: string;
  status: ListingStatus;
  tags?: string[];
  features?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ResellerOrder {
  id: string;
  resellerId: string;
  listingId: string;
  customerEmail: string;
  customerName: string;
  quantity: number;
  wholesaleTotal: number;
  retailTotal: number;
  commissionEarned: number;
  currency: string;
  status: OrderStatus;
  provisionedSubscriptionId?: string;
  orderedAt: Date;
}

export interface ResellerMetrics {
  totalSalesCount: number;
  grossRevenue: number;
  wholesaleCost: number;
  netCommissionEarned: number;
  activeListingsCount: number;
}

export interface CreateResellerInput {
  name: string;
  email: string;
  company: string;
  tier?: ResellerTier;
  currency?: string;
  branding?: ResellerBranding;
}

export interface CreateListingInput {
  resellerId: string;
  title: string;
  description: string;
  category: SubscriptionCategory;
  retailPrice: number;
  suggestedRetailPrice?: number;
  billingCycle: BillingCycle;
  currency?: string;
  tags?: string[];
  features?: string[];
}

export interface PlaceOrderInput {
  resellerId: string;
  listingId: string;
  customerEmail: string;
  customerName: string;
  quantity?: number;
}
