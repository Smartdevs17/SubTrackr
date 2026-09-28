import {
  calculateWholesalePrice,
  calculateCommission,
  getTierDiscount,
  getTierCommissionRate,
  validateListingInput,
  validateOrderInput,
  computeResellerMetrics,
  TIER_DISCOUNT_RATES,
  TIER_COMMISSION_RATES,
} from '../resellerMarketplace';
import {
  ResellerTier,
  ListingStatus,
  OrderStatus,
  MarketplaceListing,
  ResellerOrder,
} from '../../types/reseller';
import { BillingCycle, SubscriptionCategory } from '../../types/subscription';

describe('resellerMarketplace utility functions', () => {
  describe('calculateWholesalePrice', () => {
    it('calculates wholesale price accurately with standard discount', () => {
      expect(calculateWholesalePrice(100, 20)).toBe(80);
      expect(calculateWholesalePrice(49.99, 15)).toBe(42.49);
    });

    it('returns 0 if retail price is negative', () => {
      expect(calculateWholesalePrice(-50, 20)).toBe(0);
    });

    it('returns full retail price if discount is 0 or negative', () => {
      expect(calculateWholesalePrice(100, 0)).toBe(100);
      expect(calculateWholesalePrice(100, -10)).toBe(100);
    });

    it('returns 0 if discount is 100% or greater', () => {
      expect(calculateWholesalePrice(100, 100)).toBe(0);
      expect(calculateWholesalePrice(100, 110)).toBe(0);
    });
  });

  describe('calculateCommission', () => {
    it('calculates net commission correctly', () => {
      expect(calculateCommission(100, 80)).toBe(20);
      expect(calculateCommission(49.99, 39.99)).toBe(10);
    });

    it('returns 0 if retail total is less than or equal to 0', () => {
      expect(calculateCommission(0, 0)).toBe(0);
      expect(calculateCommission(-10, 5)).toBe(0);
    });

    it('returns 0 if wholesale total exceeds retail total', () => {
      expect(calculateCommission(50, 60)).toBe(0);
    });
  });

  describe('tier rates', () => {
    it('returns correct tier discount rates', () => {
      expect(getTierDiscount(ResellerTier.BRONZE)).toBe(TIER_DISCOUNT_RATES[ResellerTier.BRONZE]);
      expect(getTierDiscount(ResellerTier.SILVER)).toBe(15);
      expect(getTierDiscount(ResellerTier.GOLD)).toBe(25);
      expect(getTierDiscount(ResellerTier.PLATINUM)).toBe(35);
      expect(getTierDiscount('unknown' as any)).toBe(10);
    });

    it('returns correct tier commission rates', () => {
      expect(getTierCommissionRate(ResellerTier.BRONZE)).toBe(TIER_COMMISSION_RATES[ResellerTier.BRONZE]);
      expect(getTierCommissionRate(ResellerTier.SILVER)).toBe(10);
      expect(getTierCommissionRate(ResellerTier.GOLD)).toBe(15);
      expect(getTierCommissionRate(ResellerTier.PLATINUM)).toBe(20);
      expect(getTierCommissionRate('unknown' as any)).toBe(5);
    });
  });

  describe('validateListingInput', () => {
    it('validates valid listing input cleanly', () => {
      const result = validateListingInput({
        resellerId: 'res_123',
        title: 'Premium SaaS Pass',
        description: 'Exclusive access plan',
        category: SubscriptionCategory.SOFTWARE,
        retailPrice: 29.99,
        billingCycle: BillingCycle.MONTHLY,
      });

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('flags missing required fields', () => {
      const result = validateListingInput({
        resellerId: '',
        title: ' ',
        description: '',
        retailPrice: 0,
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Reseller ID is required');
      expect(result.errors).toContain('Listing title is required');
      expect(result.errors).toContain('Listing description is required');
      expect(result.errors).toContain('Retail price must be greater than 0');
    });
  });

  describe('validateOrderInput', () => {
    it('validates valid order input cleanly', () => {
      const result = validateOrderInput({
        resellerId: 'res_123',
        listingId: 'list_456',
        customerName: 'Jane Doe',
        customerEmail: 'jane@example.com',
        quantity: 2,
      });

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects invalid emails and missing customer details', () => {
      const result = validateOrderInput({
        resellerId: 'res_123',
        listingId: 'list_456',
        customerName: '',
        customerEmail: 'invalid-email',
        quantity: -1,
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Customer name is required');
      expect(result.errors).toContain('Valid customer email is required');
      expect(result.errors).toContain('Quantity must be a positive integer');
    });
  });

  describe('computeResellerMetrics', () => {
    it('computes metrics aggregated over completed orders and active listings', () => {
      const listings: MarketplaceListing[] = [
        {
          id: 'l1',
          resellerId: 'res_1',
          title: 'Title 1',
          description: 'Desc',
          category: SubscriptionCategory.SOFTWARE,
          wholesalePrice: 80,
          retailPrice: 100,
          billingCycle: BillingCycle.MONTHLY,
          currency: 'USD',
          status: ListingStatus.PUBLISHED,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'l2',
          resellerId: 'res_1',
          title: 'Title 2',
          description: 'Desc',
          category: SubscriptionCategory.GAMING,
          wholesalePrice: 40,
          retailPrice: 50,
          billingCycle: BillingCycle.YEARLY,
          currency: 'USD',
          status: ListingStatus.DRAFT,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const orders: ResellerOrder[] = [
        {
          id: 'o1',
          resellerId: 'res_1',
          listingId: 'l1',
          customerEmail: 'c1@test.com',
          customerName: 'Client One',
          quantity: 1,
          wholesaleTotal: 80,
          retailTotal: 100,
          commissionEarned: 20,
          currency: 'USD',
          status: OrderStatus.COMPLETED,
          orderedAt: new Date(),
        },
        {
          id: 'o2',
          resellerId: 'res_1',
          listingId: 'l1',
          customerEmail: 'c2@test.com',
          customerName: 'Client Two',
          quantity: 2,
          wholesaleTotal: 160,
          retailTotal: 200,
          commissionEarned: 40,
          currency: 'USD',
          status: OrderStatus.COMPLETED,
          orderedAt: new Date(),
        },
        {
          id: 'o3',
          resellerId: 'res_1',
          listingId: 'l1',
          customerEmail: 'c3@test.com',
          customerName: 'Client Three',
          quantity: 1,
          wholesaleTotal: 80,
          retailTotal: 100,
          commissionEarned: 20,
          currency: 'USD',
          status: OrderStatus.CANCELLED, // Should be excluded
          orderedAt: new Date(),
        },
      ];

      const metrics = computeResellerMetrics(orders, listings, 'res_1');

      expect(metrics.totalSalesCount).toBe(2);
      expect(metrics.grossRevenue).toBe(300);
      expect(metrics.wholesaleCost).toBe(240);
      expect(metrics.netCommissionEarned).toBe(60);
      expect(metrics.activeListingsCount).toBe(1);
    });
  });
});
