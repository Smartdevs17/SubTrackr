import { create } from 'zustand';
import {
  generateRetentionOffers,
  acceptRetentionOffer,
  recordCancellation,
  categorizeCancellationReason,
  analyzeSentiment,
  getRecentCancellation,
  markReactivation,
  isWithinReactivationWindow,
  RetentionOffer,
  CancellationRecord,
  UserSegmentContext,
  SentimentLabel,
} from '../../backend/services/analytics/retentionService';
import { useSubscriptionStore } from './subscriptionStore';
import { useUserStore } from './userStore';

export type CancellationStep = 'REASON' | 'FEEDBACK' | 'OFFERS' | 'CONFIRM' | 'SUCCESS';

export const CANCELLATION_REASONS = [
  'Too Expensive',
  'Switching to Competitor',
  'Technical Issues',
  'Missing Features',
  'Not Using It',
  'Other',
] as const;

export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

interface CancellationState {
  currentStep: CancellationStep;
  subscriptionId: string | null;
  reason: string | null;
  feedbackText: string;
  sentiment: SentimentLabel | null;
  offers: RetentionOffer[];
  acceptedOfferId: string | null;
  cancellationRecord: CancellationRecord | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  initFlow: (subscriptionId: string) => void;
  selectReason: (reason: string) => void;
  submitFeedback: (feedbackText: string) => Promise<void>;
  acceptOffer: (offerId: string) => Promise<void>;
  declineOffers: () => void;
  confirmCancellation: () => Promise<void>;
  /** Edge case: re-subscribing within 30 days of a cancellation. */
  checkReactivationEligibility: (
    subscriptionId: string
  ) => { withinWindow: boolean; daysSinceCancellation: number } | null;
  confirmReactivation: (subscriptionId: string) => void;
  reset: () => void;
}

const initialState = {
  currentStep: 'REASON' as CancellationStep,
  subscriptionId: null,
  reason: null,
  feedbackText: '',
  sentiment: null,
  offers: [],
  acceptedOfferId: null,
  cancellationRecord: null,
  isLoading: false,
  error: null,
};

function buildSegmentContext(subscriptionId: string): UserSegmentContext | null {
  const { subscriptions } = useSubscriptionStore.getState();
  const { user, subscriptionTier } = useUserStore.getState();

  const sub = subscriptions.find((s) => s.id === subscriptionId);
  if (!sub || !user) return null;

  const totalMonthlySpend = subscriptions
    .filter((s) => s.isActive)
    .reduce((acc, s) => acc + (s.billingCycle === 'monthly' ? s.price : s.price / 12), 0);

  const createdAt = sub.createdAt ? new Date(sub.createdAt) : new Date();
  const monthsActive = Math.max(
    1,
    Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30))
  );

  return {
    userId: user.id,
    subscriptionId: sub.id,
    subscriptionName: sub.name,
    monthlyPrice: sub.billingCycle === 'monthly' ? sub.price : sub.price / 12,
    monthsActive,
    totalMonthlySpend,
    subscriptionTier,
  };
}

export const useCancellationStore = create<CancellationState>((set, get) => ({
  ...initialState,

  initFlow: (subscriptionId) => {
    set({ ...initialState, subscriptionId });
  },

  selectReason: (reason) => {
    set({ reason, currentStep: 'FEEDBACK', error: null });
  },

  submitFeedback: async (feedbackText) => {
    set({ isLoading: true, error: null });
    try {
      const { subscriptionId, reason } = get();
      if (!subscriptionId || !reason) throw new Error('No subscription or reason selected');

      const context = buildSegmentContext(subscriptionId);
      if (!context) throw new Error('Could not load subscription context');

      const sentiment = feedbackText.trim() ? analyzeSentiment(feedbackText).label : null;
      const reasonCategory = categorizeCancellationReason(reason);
      const offers = generateRetentionOffers(context, reasonCategory);

      set({ feedbackText, sentiment, offers, currentStep: 'OFFERS', isLoading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to load offers', isLoading: false });
    }
  },

  acceptOffer: async (offerId) => {
    set({ isLoading: true, error: null });
    try {
      const { user } = useUserStore.getState();
      if (!user) throw new Error('User not found');

      const result = acceptRetentionOffer(user.id, offerId);
      if (!result.accepted) throw new Error('Offer is no longer valid or has expired');

      set({ acceptedOfferId: offerId, currentStep: 'SUCCESS', isLoading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to accept offer', isLoading: false });
    }
  },

  declineOffers: () => {
    set({ currentStep: 'CONFIRM' });
  },

  confirmCancellation: async () => {
    set({ isLoading: true, error: null });
    try {
      const { subscriptionId, reason, offers, acceptedOfferId, feedbackText } = get();
      const { user } = useUserStore.getState();

      if (!subscriptionId || !reason || !user) throw new Error('Missing cancellation data');

      const record = recordCancellation(
        user.id,
        subscriptionId,
        reason,
        offers.map((o) => o.id),
        acceptedOfferId,
        feedbackText.trim() || undefined
      );

      // Mark subscription as inactive in local store
      const { updateSubscription } = useSubscriptionStore.getState();
      if (updateSubscription) {
        updateSubscription(subscriptionId, { isActive: false });
      }

      set({ cancellationRecord: record, currentStep: 'SUCCESS', isLoading: false });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : 'Failed to process cancellation',
        isLoading: false,
      });
    }
  },

  checkReactivationEligibility: (subscriptionId) => {
    // Edge case: user cancels and re-subscribes within 30 days. Read-only check.
    const recent = getRecentCancellation(subscriptionId);
    if (!recent) return null;
    return {
      withinWindow: isWithinReactivationWindow(recent.daysSinceCancellation),
      daysSinceCancellation: recent.daysSinceCancellation,
    };
  },

  confirmReactivation: (subscriptionId) => {
    markReactivation(subscriptionId);
    const { toggleSubscriptionStatus, subscriptions } = useSubscriptionStore.getState();
    const sub = subscriptions.find((s) => s.id === subscriptionId);
    if (sub && !sub.isActive) {
      toggleSubscriptionStatus(subscriptionId);
    }
  },

  reset: () => set(initialState),
}));
