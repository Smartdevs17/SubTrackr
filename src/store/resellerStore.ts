import { create } from 'zustand';
import {
  Reseller,
  MarketplaceListing,
  ResellerOrder,
  ResellerTier,
  ResellerStatus,
  ListingStatus,
  OrderStatus,
  ResellerMetrics,
  CreateResellerInput,
  CreateListingInput,
  PlaceOrderInput,
} from '../types/reseller';
import {
  calculateWholesalePrice,
  calculateCommission,
  getTierDiscount,
  getTierCommissionRate,
  validateListingInput,
  validateOrderInput,
  computeResellerMetrics,
} from '../utils/resellerMarketplace';

export interface ResellerState {
  resellers: Reseller[];
  listings: MarketplaceListing[];
  orders: ResellerOrder[];
  activeResellerId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  createReseller: (input: CreateResellerInput) => Promise<Reseller>;
  updateReseller: (id: string, input: Partial<Reseller>) => Promise<Reseller>;
  getReseller: (id: string) => Reseller | undefined;
  setActiveReseller: (resellerId: string | null) => void;

  createListing: (input: CreateListingInput) => Promise<MarketplaceListing>;
  updateListing: (id: string, input: Partial<MarketplaceListing>) => Promise<MarketplaceListing>;
  deleteListing: (id: string) => Promise<boolean>;
  getListingsByReseller: (resellerId: string) => MarketplaceListing[];

  placeOrder: (input: PlaceOrderInput) => Promise<ResellerOrder>;
  cancelOrder: (orderId: string) => Promise<ResellerOrder>;
  getResellerMetrics: (resellerId: string) => ResellerMetrics;
  clearError: () => void;
}

export const useResellerStore = create<ResellerState>((set, get) => ({
  resellers: [],
  listings: [],
  orders: [],
  activeResellerId: null,
  isLoading: false,
  error: null,

  createReseller: async (input: CreateResellerInput) => {
    set({ isLoading: true, error: null });
    try {
      if (!input.name || !input.name.trim()) {
        throw new Error('Reseller name is required');
      }
      if (!input.email || !input.email.trim() || !input.email.includes('@')) {
        throw new Error('Valid email is required');
      }
      if (!input.company || !input.company.trim()) {
        throw new Error('Company name is required');
      }

      const tier = input.tier || ResellerTier.BRONZE;
      const discount = getTierDiscount(tier);
      const commission = getTierCommissionRate(tier);

      const newReseller: Reseller = {
        id: `reseller_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        name: input.name.trim(),
        email: input.email.trim(),
        company: input.company.trim(),
        status: ResellerStatus.ACTIVE,
        tier,
        commissionRate: commission,
        wholesaleDiscountPercentage: discount,
        balance: 0,
        currency: input.currency || 'USD',
        branding: input.branding,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      set((state) => ({
        resellers: [...state.resellers, newReseller],
        activeResellerId: state.activeResellerId || newReseller.id,
        isLoading: false,
      }));

      return newReseller;
    } catch (err: any) {
      const msg = err?.message || 'Failed to create reseller';
      set({ error: msg, isLoading: false });
      throw new Error(msg);
    }
  },

  updateReseller: async (id: string, input: Partial<Reseller>) => {
    set({ isLoading: true, error: null });
    try {
      const reseller = get().resellers.find((r) => r.id === id);
      if (!reseller) {
        throw new Error(`Reseller with ID ${id} not found`);
      }

      const updatedReseller: Reseller = {
        ...reseller,
        ...input,
        updatedAt: new Date(),
      };

      set((state) => ({
        resellers: state.resellers.map((r) => (r.id === id ? updatedReseller : r)),
        isLoading: false,
      }));

      return updatedReseller;
    } catch (err: any) {
      const msg = err?.message || 'Failed to update reseller';
      set({ error: msg, isLoading: false });
      throw new Error(msg);
    }
  },

  getReseller: (id: string) => {
    return get().resellers.find((r) => r.id === id);
  },

  setActiveReseller: (resellerId: string | null) => {
    set({ activeResellerId: resellerId });
  },

  createListing: async (input: CreateListingInput) => {
    set({ isLoading: true, error: null });
    try {
      const validation = validateListingInput(input);
      if (!validation.isValid) {
        throw new Error(validation.errors.join('; '));
      }

      const reseller = get().resellers.find((r) => r.id === input.resellerId);
      if (!reseller) {
        throw new Error(`Reseller with ID ${input.resellerId} not found`);
      }

      const discountPercentage = reseller.wholesaleDiscountPercentage;
      const wholesalePrice = calculateWholesalePrice(input.retailPrice, discountPercentage);

      const newListing: MarketplaceListing = {
        id: `listing_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        resellerId: input.resellerId,
        title: input.title.trim(),
        description: input.description.trim(),
        category: input.category,
        wholesalePrice,
        retailPrice: input.retailPrice,
        suggestedRetailPrice: input.suggestedRetailPrice || input.retailPrice,
        billingCycle: input.billingCycle,
        currency: input.currency || reseller.currency || 'USD',
        status: ListingStatus.PUBLISHED,
        tags: input.tags || [],
        features: input.features || [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      set((state) => ({
        listings: [...state.listings, newListing],
        isLoading: false,
      }));

      return newListing;
    } catch (err: any) {
      const msg = err?.message || 'Failed to create listing';
      set({ error: msg, isLoading: false });
      throw new Error(msg);
    }
  },

  updateListing: async (id: string, input: Partial<MarketplaceListing>) => {
    set({ isLoading: true, error: null });
    try {
      const listing = get().listings.find((l) => l.id === id);
      if (!listing) {
        throw new Error(`Listing with ID ${id} not found`);
      }

      const updatedListing: MarketplaceListing = {
        ...listing,
        ...input,
        updatedAt: new Date(),
      };

      set((state) => ({
        listings: state.listings.map((l) => (l.id === id ? updatedListing : l)),
        isLoading: false,
      }));

      return updatedListing;
    } catch (err: any) {
      const msg = err?.message || 'Failed to update listing';
      set({ error: msg, isLoading: false });
      throw new Error(msg);
    }
  },

  deleteListing: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const listing = get().listings.find((l) => l.id === id);
      if (!listing) {
        throw new Error(`Listing with ID ${id} not found`);
      }

      set((state) => ({
        listings: state.listings.filter((l) => l.id !== id),
        isLoading: false,
      }));

      return true;
    } catch (err: any) {
      const msg = err?.message || 'Failed to delete listing';
      set({ error: msg, isLoading: false });
      throw new Error(msg);
    }
  },

  getListingsByReseller: (resellerId: string) => {
    return get().listings.filter((l) => l.resellerId === resellerId);
  },

  placeOrder: async (input: PlaceOrderInput) => {
    set({ isLoading: true, error: null });
    try {
      const validation = validateOrderInput(input);
      if (!validation.isValid) {
        throw new Error(validation.errors.join('; '));
      }

      const reseller = get().resellers.find((r) => r.id === input.resellerId);
      if (!reseller) {
        throw new Error(`Reseller with ID ${input.resellerId} not found`);
      }

      const listing = get().listings.find((l) => l.id === input.listingId);
      if (!listing) {
        throw new Error(`Listing with ID ${input.listingId} not found`);
      }

      if (listing.status !== ListingStatus.PUBLISHED) {
        throw new Error('Cannot order an unpublished listing');
      }

      const quantity = input.quantity || 1;
      const wholesaleTotal = Math.round(listing.wholesalePrice * quantity * 100) / 100;
      const retailTotal = Math.round(listing.retailPrice * quantity * 100) / 100;
      const commissionEarned = calculateCommission(retailTotal, wholesaleTotal);

      const newOrder: ResellerOrder = {
        id: `order_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        resellerId: input.resellerId,
        listingId: input.listingId,
        customerEmail: input.customerEmail.trim(),
        customerName: input.customerName.trim(),
        quantity,
        wholesaleTotal,
        retailTotal,
        commissionEarned,
        currency: listing.currency,
        status: OrderStatus.COMPLETED,
        provisionedSubscriptionId: `sub_reseller_${Date.now()}`,
        orderedAt: new Date(),
      };

      // Update reseller balance with net commission
      const updatedBalance = Math.round((reseller.balance + commissionEarned) * 100) / 100;
      const updatedReseller: Reseller = {
        ...reseller,
        balance: updatedBalance,
        updatedAt: new Date(),
      };

      set((state) => ({
        orders: [...state.orders, newOrder],
        resellers: state.resellers.map((r) => (r.id === reseller.id ? updatedReseller : r)),
        isLoading: false,
      }));

      return newOrder;
    } catch (err: any) {
      const msg = err?.message || 'Failed to place order';
      set({ error: msg, isLoading: false });
      throw new Error(msg);
    }
  },

  cancelOrder: async (orderId: string) => {
    set({ isLoading: true, error: null });
    try {
      const order = get().orders.find((o) => o.id === orderId);
      if (!order) {
        throw new Error(`Order with ID ${orderId} not found`);
      }

      if (order.status === OrderStatus.CANCELLED) {
        throw new Error('Order is already cancelled');
      }

      const updatedOrder: ResellerOrder = {
        ...order,
        status: OrderStatus.CANCELLED,
      };

      // Adjust reseller balance if order was previously completed
      if (order.status === OrderStatus.COMPLETED) {
        const reseller = get().resellers.find((r) => r.id === order.resellerId);
        if (reseller) {
          const updatedBalance = Math.max(
            0,
            Math.round((reseller.balance - order.commissionEarned) * 100) / 100
          );
          set((state) => ({
            resellers: state.resellers.map((r) =>
              r.id === reseller.id ? { ...r, balance: updatedBalance } : r
            ),
          }));
        }
      }

      set((state) => ({
        orders: state.orders.map((o) => (o.id === orderId ? updatedOrder : o)),
        isLoading: false,
      }));

      return updatedOrder;
    } catch (err: any) {
      const msg = err?.message || 'Failed to cancel order';
      set({ error: msg, isLoading: false });
      throw new Error(msg);
    }
  },

  getResellerMetrics: (resellerId: string) => {
    const { orders, listings } = get();
    return computeResellerMetrics(orders, listings, resellerId);
  },

  clearError: () => {
    set({ error: null });
  },
}));
