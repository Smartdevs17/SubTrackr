import { useResellerStore } from '../resellerStore';
import { ResellerTier, ListingStatus, OrderStatus } from '../../types/reseller';
import { BillingCycle, SubscriptionCategory } from '../../types/subscription';

describe('useResellerStore', () => {
  beforeEach(() => {
    useResellerStore.setState({
      resellers: [],
      listings: [],
      orders: [],
      activeResellerId: null,
      isLoading: false,
      error: null,
    });
  });

  describe('createReseller', () => {
    it('creates a reseller account successfully', async () => {
      const reseller = await useResellerStore.getState().createReseller({
        name: 'Acme Reseller',
        email: 'partner@acme.com',
        company: 'Acme Corp',
        tier: ResellerTier.SILVER,
      });

      expect(reseller.id).toBeDefined();
      expect(reseller.name).toBe('Acme Reseller');
      expect(reseller.tier).toBe(ResellerTier.SILVER);
      expect(reseller.wholesaleDiscountPercentage).toBe(15);
      expect(reseller.commissionRate).toBe(10);
      expect(useResellerStore.getState().resellers).toHaveLength(1);
      expect(useResellerStore.getState().activeResellerId).toBe(reseller.id);
    });

    it('throws error if required fields are missing', async () => {
      await expect(
        useResellerStore.getState().createReseller({
          name: '',
          email: 'invalid',
          company: '',
        })
      ).rejects.toThrow('Reseller name is required');
    });
  });

  describe('createListing', () => {
    it('creates a marketplace listing with automatic wholesale pricing', async () => {
      const reseller = await useResellerStore.getState().createReseller({
        name: 'TechResell',
        email: 'sales@techresell.io',
        company: 'TechResell LLC',
        tier: ResellerTier.GOLD, // 25% discount
      });

      const listing = await useResellerStore.getState().createListing({
        resellerId: reseller.id,
        title: 'Cloud Storage Pro',
        description: '1TB Secure Cloud Storage',
        category: SubscriptionCategory.SOFTWARE,
        retailPrice: 100,
        billingCycle: BillingCycle.MONTHLY,
      });

      expect(listing.id).toBeDefined();
      expect(listing.wholesalePrice).toBe(75); // 25% off 100
      expect(listing.retailPrice).toBe(100);
      expect(listing.status).toBe(ListingStatus.PUBLISHED);
      expect(useResellerStore.getState().listings).toHaveLength(1);
    });

    it('throws error if reseller is not found', async () => {
      await expect(
        useResellerStore.getState().createListing({
          resellerId: 'non_existent',
          title: 'Cloud Pass',
          description: 'Desc',
          category: SubscriptionCategory.SOFTWARE,
          retailPrice: 50,
          billingCycle: BillingCycle.MONTHLY,
        })
      ).rejects.toThrow('Reseller with ID non_existent not found');
    });
  });

  describe('placeOrder', () => {
    it('places an order and credits reseller balance with commission', async () => {
      const reseller = await useResellerStore.getState().createReseller({
        name: 'Distro Inc',
        email: 'orders@distro.com',
        company: 'Distro Inc',
        tier: ResellerTier.GOLD, // 25% discount
      });

      const listing = await useResellerStore.getState().createListing({
        resellerId: reseller.id,
        title: 'Dev Suite Annual',
        description: 'Full dev toolkit',
        category: SubscriptionCategory.PRODUCTIVITY,
        retailPrice: 200,
        billingCycle: BillingCycle.YEARLY,
      });

      const order = await useResellerStore.getState().placeOrder({
        resellerId: reseller.id,
        listingId: listing.id,
        customerName: 'Alice Smith',
        customerEmail: 'alice@example.com',
        quantity: 2,
      });

      // Wholesale price per unit = 150 (25% off 200). For quantity 2 => wholesaleTotal = 300, retailTotal = 400.
      expect(order.wholesaleTotal).toBe(300);
      expect(order.retailTotal).toBe(400);
      expect(order.commissionEarned).toBe(100);
      expect(order.status).toBe(OrderStatus.COMPLETED);

      const updatedReseller = useResellerStore.getState().getReseller(reseller.id);
      expect(updatedReseller?.balance).toBe(100);
    });

    it('throws error when listing is unpublished or non-existent', async () => {
      const reseller = await useResellerStore.getState().createReseller({
        name: 'Distro Inc',
        email: 'orders@distro.com',
        company: 'Distro Inc',
      });

      await expect(
        useResellerStore.getState().placeOrder({
          resellerId: reseller.id,
          listingId: 'unknown_listing',
          customerName: 'Bob',
          customerEmail: 'bob@example.com',
        })
      ).rejects.toThrow('Listing with ID unknown_listing not found');
    });
  });

  describe('cancelOrder', () => {
    it('cancels a completed order and adjusts reseller balance', async () => {
      const reseller = await useResellerStore.getState().createReseller({
        name: 'Vendor X',
        email: 'x@vendor.com',
        company: 'Vendor X Ltd',
        tier: ResellerTier.SILVER, // 15% discount
      });

      const listing = await useResellerStore.getState().createListing({
        resellerId: reseller.id,
        title: 'Streaming VIP',
        description: 'VIP Pass',
        category: SubscriptionCategory.STREAMING,
        retailPrice: 100,
        billingCycle: BillingCycle.MONTHLY,
      });

      const order = await useResellerStore.getState().placeOrder({
        resellerId: reseller.id,
        listingId: listing.id,
        customerName: 'Charlie',
        customerEmail: 'charlie@test.com',
      });

      expect(useResellerStore.getState().getReseller(reseller.id)?.balance).toBe(15);

      const cancelledOrder = await useResellerStore.getState().cancelOrder(order.id);
      expect(cancelledOrder.status).toBe(OrderStatus.CANCELLED);
      expect(useResellerStore.getState().getReseller(reseller.id)?.balance).toBe(0);
    });

    it('throws error when trying to cancel an already cancelled order', async () => {
      const reseller = await useResellerStore.getState().createReseller({
        name: 'Vendor X',
        email: 'x@vendor.com',
        company: 'Vendor X Ltd',
      });

      const listing = await useResellerStore.getState().createListing({
        resellerId: reseller.id,
        title: 'Streaming VIP',
        description: 'VIP Pass',
        category: SubscriptionCategory.STREAMING,
        retailPrice: 50,
        billingCycle: BillingCycle.MONTHLY,
      });

      const order = await useResellerStore.getState().placeOrder({
        resellerId: reseller.id,
        listingId: listing.id,
        customerName: 'Dave',
        customerEmail: 'dave@test.com',
      });

      await useResellerStore.getState().cancelOrder(order.id);

      await expect(
        useResellerStore.getState().cancelOrder(order.id)
      ).rejects.toThrow('Order is already cancelled');
    });
  });

  describe('getResellerMetrics', () => {
    it('returns aggregated reseller metrics', async () => {
      const reseller = await useResellerStore.getState().createReseller({
        name: 'Metrics Partner',
        email: 'metrics@partner.com',
        company: 'Metrics Partner Inc',
      });

      const listing = await useResellerStore.getState().createListing({
        resellerId: reseller.id,
        title: 'App Sub',
        description: 'App Sub',
        category: SubscriptionCategory.SOFTWARE,
        retailPrice: 100,
        billingCycle: BillingCycle.MONTHLY,
      });

      await useResellerStore.getState().placeOrder({
        resellerId: reseller.id,
        listingId: listing.id,
        customerName: 'Eve',
        customerEmail: 'eve@test.com',
      });

      const metrics = useResellerStore.getState().getResellerMetrics(reseller.id);

      expect(metrics.totalSalesCount).toBe(1);
      expect(metrics.activeListingsCount).toBe(1);
      expect(metrics.grossRevenue).toBe(100);
    });
  });
});
