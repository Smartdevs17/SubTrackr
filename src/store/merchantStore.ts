import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import {
  MerchantOnboarding,
  MerchantOnboardingFormData,
  OnboardingStep,
  OnboardingStatus,
  VerificationTier,
  MerchantDocument,
  DocumentType,
  OnboardingNotification,
  OnboardingAnalytics,
  KycVerificationRequest,
} from '../types/merchant';

const STORAGE_KEY = 'subtrackr-merchant-onboarding';
const STORE_VERSION = 1;

interface MerchantState {
  onboarding: MerchantOnboarding | null;
  isLoading: boolean;
  error: string | null;
  kycRequests: KycVerificationRequest[];

  startOnboarding: (data: MerchantOnboardingFormData) => Promise<void>;
  submitDocument: (docType: DocumentType, uri: string) => Promise<void>;
  nextStep: () => Promise<void>;
  previousStep: () => Promise<void>;
  requestVerification: () => Promise<void>;
  approveVerification: (tier: VerificationTier, notes?: string) => Promise<void>;
  rejectVerification: (reason: string) => Promise<void>;
  getOnboardingStatus: () => OnboardingStatus;
  addNotification: (
    notification: Omit<OnboardingNotification, 'id' | 'createdAt' | 'read'>
  ) => void;
  markNotificationRead: (notificationId: string) => void;
  getUnreadNotificationCount: () => number;
  getOnboardingAnalytics: () => OnboardingAnalytics;
  submitKycRequest: () => Promise<void>;
  uploadDocument: (docType: DocumentType, uri: string) => Promise<void>;
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
      kycRequests: [],

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
            completedSteps: [],
            notifications: [],
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

      addNotification: (notification) => {
        const { onboarding } = get();
        if (!onboarding) return;

        const newNotification: OnboardingNotification = {
          ...notification,
          id: generateUniqueId(),
          createdAt: new Date(),
          read: false,
        };

        set({
          onboarding: {
            ...onboarding,
            notifications: [...onboarding.notifications, newNotification],
            updatedAt: new Date(),
          },
        });
      },

      markNotificationRead: (notificationId) => {
        const { onboarding } = get();
        if (!onboarding) return;

        set({
          onboarding: {
            ...onboarding,
            notifications: onboarding.notifications.map((n) =>
              n.id === notificationId ? { ...n, read: true } : n
            ),
            updatedAt: new Date(),
          },
        });
      },

      getUnreadNotificationCount: () => {
        const { onboarding } = get();
        if (!onboarding) return 0;
        return onboarding.notifications.filter((n) => !n.read).length;
      },

      getOnboardingAnalytics: (): OnboardingAnalytics => {
        const { onboarding, kycRequests } = get();
        const totalStarted = onboarding ? 1 : 0;
        const totalCompleted = onboarding?.status === OnboardingStatus.VERIFIED ? 1 : 0;
        const totalRejected = onboarding?.status === OnboardingStatus.REJECTED ? 1 : 0;
        const completionRate = totalStarted > 0 ? totalCompleted / totalStarted : 0;

        let averageTimeToComplete = 0;
        if (onboarding?.status === OnboardingStatus.VERIFIED) {
          const startTime = new Date(onboarding.startedAt).getTime();
          const endTime = new Date(onboarding.updatedAt).getTime();
          averageTimeToComplete = (endTime - startTime) / (1000 * 60 * 60 * 24);
        }

        const dropOffByStep: Record<string, number> = {};
        if (onboarding) {
          const currentStepIndex = onboarding.steps.indexOf(onboarding.currentStep);
          onboarding.steps.forEach((step, index) => {
            if (index > currentStepIndex) {
              dropOffByStep[step] = (dropOffByStep[step] || 0) + 1;
            }
          });
        }

        const totalDocuments = onboarding?.documents.length || 0;
        const rejectedDocuments =
          onboarding?.documents.filter((d) => d.status === 'rejected').length || 0;
        const documentRejectionRate = totalDocuments > 0 ? rejectedDocuments / totalDocuments : 0;

        let averageVerificationTime = 0;
        const verifiedRequests = kycRequests.filter((r) => r.status === 'approved');
        if (verifiedRequests.length > 0) {
          averageVerificationTime = verifiedRequests.length;
        }

        return {
          totalStarted,
          totalCompleted,
          totalRejected,
          completionRate,
          averageTimeToComplete,
          dropOffByStep,
          documentRejectionRate,
          averageVerificationTime,
        };
      },

      submitKycRequest: async () => {
        const { onboarding } = get();
        if (!onboarding) return;

        set({ isLoading: true, error: null });
        try {
          const kycRequest: KycVerificationRequest = {
            merchantId: onboarding.id,
            documents: onboarding.documents,
            businessInfo: {
              businessName: onboarding.merchantAddress,
              businessType: '',
              country: '',
              phoneNumber: '',
              email: onboarding.merchantAddress,
            },
            submittedAt: new Date(),
            status: 'pending',
          };

          set((state) => ({
            kycRequests: [...state.kycRequests, kycRequest],
            onboarding: {
              ...state.onboarding!,
              status: OnboardingStatus.PENDING_REVIEW,
              updatedAt: new Date(),
            },
            isLoading: false,
          }));
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to submit KYC request',
            isLoading: false,
          });
        }
      },

      uploadDocument: async (docType: DocumentType, uri: string) => {
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

          const notification: OnboardingNotification = {
            id: generateUniqueId(),
            type: 'document_uploaded',
            title: 'Document Uploaded',
            message: `Your ${docType.replace(/_/g, ' ')} has been uploaded successfully.`,
            createdAt: new Date(),
            read: false,
          };

          set({
            onboarding: {
              ...onboarding,
              documents: [...onboarding.documents, newDoc],
              notifications: [...onboarding.notifications, notification],
              updatedAt: new Date(),
            },
            isLoading: false,
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to upload document',
            isLoading: false,
          });
        }
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (state) => ({ onboarding: state.onboarding }),
    }
  )
);
