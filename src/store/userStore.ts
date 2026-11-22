/**
 * userStore.ts — User profile + consent state (slices pattern).
 *
 * Delegates to the combined `useAppStore` (see slices/index.ts). The legacy
 * `useUserStore` hook is preserved so all existing consumers keep their exact
 * behaviour (`useUserStore()`, `.getState()`, `.setState()` all work).
 */

import { useAppStore, UserSlice } from './slices';
import { UserProfile } from '../types/api';
import { SubscriptionTier } from '../types/subscription';

export type UserState = UserSlice;

export interface ConsentState {
  analytics: boolean;
  marketing: boolean;
  notifications: boolean;
  hasAcceptedPolicy: boolean;
}

/**
 * Legacy hook — backed by the combined app store.
 */
export const useUserStore = useAppStore;

export const selectUser = (s: UserState) => s.user;
export const selectSubscriptionTier = (s: UserState) => s.subscriptionTier;
export const selectConsent = (s: UserState) => s.consent;

export type { UserProfile };
export { SubscriptionTier };
