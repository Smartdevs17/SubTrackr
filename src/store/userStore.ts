import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import { UserProfile } from '../types/api';
import { SubscriptionTier } from '../types/subscription';

interface ConsentState {
  analytics: boolean;
  marketing: boolean;
  notifications: boolean;
  hasAcceptedPolicy: boolean;
}

interface UserState {
  user: UserProfile | null;
  subscriptionTier: SubscriptionTier;
  consent: ConsentState;
  setUser: (user: UserProfile | null) => void;
  setSubscriptionTier: (subscriptionTier: SubscriptionTier) => void;
  setConsent: (consent: Partial<ConsentState>) => void;
  acceptAll: () => void;
  resetConsent: () => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      user: null,
      subscriptionTier: SubscriptionTier.FREE,
      consent: {
        analytics: false,
        marketing: false,
        notifications: true, // Default to true for core functionality
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
      setConsent: (newConsent) =>
        set((state) => ({
          consent: { ...state.consent, ...newConsent },
        })),
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
    }),
    {
      name: 'subtrackr-user-store',
      storage: createJSONStorage(() => asyncStorageAdapter),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn('[userStore] Hydration error — resetting to defaults:', error);
          useUserStore.setState({
            user: null,
            subscriptionTier: SubscriptionTier.FREE,
            consent: {
              analytics: false,
              marketing: false,
              notifications: true,
              hasAcceptedPolicy: false,
            },
          });
        }
      },
    }
  )
);
