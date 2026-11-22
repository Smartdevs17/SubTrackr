/**
 * userSlice.ts — User profile + consent slice for the slices-pattern store.
 */

import { SliceCreator } from './types';
import type { AppState } from './state';
import { UserProfile } from '../../types/api';
import { SubscriptionTier } from '../../types/subscription';

export interface ConsentState {
  analytics: boolean;
  marketing: boolean;
  notifications: boolean;
  hasAcceptedPolicy: boolean;
}

export interface UserSlice {
  user: UserProfile | null;
  subscriptionTier: SubscriptionTier;
  consent: ConsentState;

  setUser: (user: UserProfile | null) => void;
  setSubscriptionTier: (subscriptionTier: SubscriptionTier) => void;
  setConsent: (consent: Partial<ConsentState>) => void;
  acceptAll: () => void;
  resetConsent: () => void;
}

export type UserStoreState = AppState;

export const createUserSlice: SliceCreator<UserSlice> = (set) => ({
  user: null,
  subscriptionTier: SubscriptionTier.FREE,
  consent: {
    analytics: false,
    marketing: false,
    notifications: true,
    hasAcceptedPolicy: false,
  },

  setUser: (user) =>
    set((state) => ({
      user,
      subscriptionTier: user
        ? (user.subscriptionTier ?? state.subscriptionTier)
        : SubscriptionTier.FREE,
    })),

  setSubscriptionTier: (subscriptionTier) => set(() => ({ subscriptionTier })),
  setConsent: (newConsent) => set((state) => ({ consent: { ...state.consent, ...newConsent } })),
  acceptAll: () =>
    set(() => ({
      consent: {
        analytics: true,
        marketing: true,
        notifications: true,
        hasAcceptedPolicy: true,
      },
    })),
  resetConsent: () =>
    set(() => ({
      consent: {
        analytics: false,
        marketing: false,
        notifications: false,
        hasAcceptedPolicy: false,
      },
    })),
});
