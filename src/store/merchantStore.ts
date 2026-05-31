import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MerchantOnboarding,
  MerchantOnboardingFormData,
  OnboardingStep,
  OnboardingStatus,
  VerificationTier,
  MerchantDocument,
  DocumentType,
} from '../types/merchant';
import { CACHE_CONSTANTS } from '../utils/constants/values';

const STORAGE_KEY = 'subtrackr-merchant-onboarding';
const STORE_VERSION = 1;
const WRITE_DEBOUNCE_MS = CACHE_CONSTANTS.WRITE_DEBOUNCE_MS;

interface MerchantState {
  onboarding: MerchantOnboarding | null;
  isLoading: boolean;
  error: string | null;

  startOnboarding: (data: MerchantOnboardingFormData) => Promise<void>;
  submitDocument: (docType: DocumentType, uri: string) => Promise<void>;
  nextStep: () => Promise<void>;
  previousStep: () => Promise<void>;
  requestVerification: () => Promise<void>;
  approveVerification: (tier: VerificationTier, notes?: string) => Promise<void>;
  rejectVerification: (reason: string) => Promise<void>;
  getOnboardingStatus: () => OnboardingStatus;
}

const generateUniqueId = (): string => {
  const timestamp = Date.now().toString(36);
  const randomComponent = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${randomComponent}`;
};

const getDefaultSteps = (): OnboardingStep[] => [
  OnboardingStep.BUSINESS_INFO,
  OnboardingStep.ID_DOCUMENT,
  OnboardingStep.BUSINESS_LICENSE,
  OnboardingStep.REVIEW,
];

export const useMerchantStore = create<MerchantState>()(
  persist(
    (set, get) => ({
      onboarding: null,
      isLoading: false,
      error: null,

      startOnboarding: async (data: MerchantOnboardingFormData) => {
        set({ isLoading: true, error: null });
        try {
          const newOnboarding: MerchantOnboarding = {
            id: generateUniqueId(),
            merchantAddress: data.email,
            steps: getDefaultSteps(),
            currentStep: OnboardingStep.BUSINESS_INFO,
            status: OnboardingStatus.IN_PROGRESS,
            documents: [],
            startedAt: new Date(),
            updatedAt: new Date(),
          };
          set({ onboarding: newOnboarding, isLoading: false });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to start onboarding',
            isLoading: false,
          });
        }
      },

      submitDocument: async (docType: DocumentType, uri: string) => {
        set({ isLoading: true, error: null });
        try {
          const { onboarding } = get();
          if (!onboarding) throw new Error('No onboarding in progress');

          const newDoc: MerchantDocument = {
            id: generateUniqueId(),
            type: docType,
            uri,
            uploadedAt: new Date(),
            status: 'pending',
          };

          set({
            onboarding: {
              ...onboarding,
              documents: [...onboarding.documents, newDoc],
              updatedAt: new Date(),
            },
            isLoading: false,
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to submit document',
            isLoading: false,
          });
        }
      },

      nextStep: async () => {
        const { onboarding } = get();
        if (!onboarding) return;

        const currentIndex = onboarding.steps.indexOf(onboarding.currentStep);
        if (currentIndex >= onboarding.steps.length - 1) return;

        const currentStep = onboarding.steps[currentIndex + 1];
        const newStatus =
          currentStep === OnboardingStep.REVIEW
            ? OnboardingStatus.PENDING_REVIEW
            : OnboardingStatus.IN_PROGRESS;

        set({
          onboarding: {
            ...onboarding,
            currentStep,
            status: newStatus,
            updatedAt: new Date(),
          },
        });
      },

      previousStep: async () => {
        const { onboarding } = get();
        if (!onboarding) return;

        const currentIndex = onboarding.steps.indexOf(onboarding.currentStep);
        if (currentIndex <= 0) return;

        set({
          onboarding: {
            ...onboarding,
            currentStep: onboarding.steps[currentIndex - 1],
            status: OnboardingStatus.IN_PROGRESS,
            updatedAt: new Date(),
          },
        });
      },

      requestVerification: async () => {
        const { onboarding } = get();
        if (!onboarding) return;

        set({
          onboarding: {
            ...onboarding,
            status: OnboardingStatus.PENDING_REVIEW,
            updatedAt: new Date(),
          },
        });
      },

      approveVerification: async (tier: VerificationTier, notes?: string) => {
        const { onboarding } = get();
        if (!onboarding) return;

        const limits =
          tier === VerificationTier.ENHANCED
            ? { monthlyVolume: 1000000, maxTransactions: 10000 }
            : { monthlyVolume: 10000, maxTransactions: 100 };

        set({
          onboarding: {
            ...onboarding,
            status: OnboardingStatus.VERIFIED,
            verificationResult: {
              isVerified: true,
              tier,
              reviewedAt: new Date(),
              reviewerNotes: notes,
              limits,
            },
            updatedAt: new Date(),
          },
        });
      },

      rejectVerification: async (reason: string) => {
        const { onboarding } = get();
        if (!onboarding) return;

        set({
          onboarding: {
            ...onboarding,
            status: OnboardingStatus.REJECTED,
            verificationResult: {
              isVerified: false,
              tier: VerificationTier.BASIC,
              reviewedAt: new Date(),
              reviewerNotes: reason,
              limits: { monthlyVolume: 0, maxTransactions: 0 },
            },
            updatedAt: new Date(),
          },
        });
      },

      getOnboardingStatus: () => {
        const { onboarding } = get();
        return onboarding?.status ?? OnboardingStatus.NOT_STARTED;
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ onboarding: state.onboarding }),
    }
  )
);
