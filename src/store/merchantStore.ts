import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
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

const STORAGE_KEY = 'subtrackr-merchant-onboarding';
const STORE_VERSION = 2;

// ── Extended types ────────────────────────────────────────────────────────────

export interface ComplianceResult {
  passed: boolean;
  sanctionsHit: boolean;
  pepHit: boolean;
  checkedAt: Date;
  notes?: string;
}

export interface PaymentSetup {
  method: 'stellar_xlm' | 'stellar_usdc' | 'bank_transfer';
  walletAddress?: string;
  bankAccountLast4?: string;
  configuredAt: Date;
}

export interface ExtendedMerchantOnboarding extends MerchantOnboarding {
  formData: Partial<MerchantOnboardingFormData>;
  compliance?: ComplianceResult;
  paymentSetup?: PaymentSetup;
  welcomeTourCompleted: boolean;
  /** ISO timestamp of last save for resume detection */
  savedAt: string;
  /** Verification timeout: ISO timestamp */
  verificationDeadline?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const generateUniqueId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;

const ONBOARDING_EXPIRY_DAYS = 30;

const getDefaultSteps = (): OnboardingStep[] => [
  OnboardingStep.BUSINESS_INFO,
  OnboardingStep.ID_DOCUMENT,
  OnboardingStep.BUSINESS_LICENSE,
  OnboardingStep.REVIEW,
];

/** Simulate compliance screening (sanctions + PEP check). */
const runComplianceCheck = async (
  data: Partial<MerchantOnboardingFormData>,
): Promise<ComplianceResult> => {
  // In production this calls a real KYB/AML provider.
  // Blocked countries list (simplified).
  const BLOCKED_COUNTRIES = ['KP', 'IR', 'SY', 'CU'];
  const sanctionsHit = BLOCKED_COUNTRIES.includes((data.country ?? '').toUpperCase());
  const pepHit = false; // placeholder
  return {
    passed: !sanctionsHit && !pepHit,
    sanctionsHit,
    pepHit,
    checkedAt: new Date(),
  };
};

// ── Store interface ───────────────────────────────────────────────────────────

interface MerchantState {
  onboarding: ExtendedMerchantOnboarding | null;
  isLoading: boolean;
  error: string | null;

  /** Start or resume an onboarding session. */
  startOnboarding: (data: MerchantOnboardingFormData) => Promise<void>;
  /** Save current form data without advancing step (save-and-resume). */
  saveProgress: (data: Partial<MerchantOnboardingFormData>) => void;
  submitDocument: (docType: DocumentType, uri: string) => Promise<void>;
  retryRejectedDocument: (docId: string, newUri: string) => Promise<void>;
  nextStep: () => Promise<void>;
  previousStep: () => void;
  runComplianceScreening: () => Promise<ComplianceResult>;
  configurePayment: (setup: Omit<PaymentSetup, 'configuredAt'>) => void;
  requestVerification: () => Promise<void>;
  approveVerification: (tier: VerificationTier, notes?: string) => void;
  rejectVerification: (reason: string) => void;
  completeWelcomeTour: () => void;
  getOnboardingStatus: () => OnboardingStatus;
  /** True if a previous incomplete session exists and can be resumed. */
  canResume: () => boolean;
  clearOnboarding: () => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useMerchantStore = create<MerchantState>()(
  persist(
    (set, get) => ({
      onboarding: null,
      isLoading: false,
      error: null,

      startOnboarding: async (data) => {
        set({ isLoading: true, error: null });
        try {
          const existing = get().onboarding;
          // Resume if an in-progress session exists and hasn't expired
          if (existing && existing.status === OnboardingStatus.IN_PROGRESS) {
            const savedAt = new Date(existing.savedAt);
            const expired =
              Date.now() - savedAt.getTime() > ONBOARDING_EXPIRY_DAYS * 86_400_000;
            if (!expired) {
              set({
                onboarding: {
                  ...existing,
                  formData: { ...existing.formData, ...data },
                  savedAt: new Date().toISOString(),
                },
                isLoading: false,
              });
              return;
            }
          }

          const now = new Date();
          const newOnboarding: ExtendedMerchantOnboarding = {
            id: generateUniqueId(),
            merchantAddress: data.email,
            steps: getDefaultSteps(),
            currentStep: OnboardingStep.BUSINESS_INFO,
            status: OnboardingStatus.IN_PROGRESS,
            documents: [],
            formData: data,
            welcomeTourCompleted: false,
            savedAt: now.toISOString(),
            startedAt: now,
            updatedAt: now,
            expiresAt: new Date(now.getTime() + ONBOARDING_EXPIRY_DAYS * 86_400_000),
          };
          set({ onboarding: newOnboarding, isLoading: false });
        } catch (err) {
          set({ error: err instanceof Error ? err.message : 'Failed to start onboarding', isLoading: false });
        }
      },

      saveProgress: (data) => {
        const { onboarding } = get();
        if (!onboarding) return;
        set({
          onboarding: {
            ...onboarding,
            formData: { ...onboarding.formData, ...data },
            savedAt: new Date().toISOString(),
            updatedAt: new Date(),
          },
        });
      },

      submitDocument: async (docType, uri) => {
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

          // Replace existing doc of same type if present
          const docs = onboarding.documents.filter((d) => d.type !== docType);
          set({
            onboarding: { ...onboarding, documents: [...docs, newDoc], updatedAt: new Date() },
            isLoading: false,
          });
        } catch (err) {
          set({ error: err instanceof Error ? err.message : 'Failed to submit document', isLoading: false });
        }
      },

      retryRejectedDocument: async (docId, newUri) => {
        const { onboarding } = get();
        if (!onboarding) return;
        const docs = onboarding.documents.map((d) =>
          d.id === docId ? { ...d, uri: newUri, status: 'pending' as const, uploadedAt: new Date() } : d,
        );
        set({ onboarding: { ...onboarding, documents: docs, updatedAt: new Date() } });
      },

      nextStep: async () => {
        const { onboarding } = get();
        if (!onboarding) return;

        const idx = onboarding.steps.indexOf(onboarding.currentStep);
        if (idx >= onboarding.steps.length - 1) return;

        const nextStep = onboarding.steps[idx + 1];

        // Auto-run compliance before REVIEW step
        if (nextStep === OnboardingStep.REVIEW && !onboarding.compliance) {
          await get().runComplianceScreening();
        }

        const newStatus =
          nextStep === OnboardingStep.REVIEW
            ? OnboardingStatus.PENDING_REVIEW
            : OnboardingStatus.IN_PROGRESS;

        set({
          onboarding: {
            ...get().onboarding!,
            currentStep: nextStep,
            status: newStatus,
            savedAt: new Date().toISOString(),
            updatedAt: new Date(),
          },
        });
      },

      previousStep: () => {
        const { onboarding } = get();
        if (!onboarding) return;
        const idx = onboarding.steps.indexOf(onboarding.currentStep);
        if (idx <= 0) return;
        set({
          onboarding: {
            ...onboarding,
            currentStep: onboarding.steps[idx - 1],
            status: OnboardingStatus.IN_PROGRESS,
            savedAt: new Date().toISOString(),
            updatedAt: new Date(),
          },
        });
      },

      runComplianceScreening: async () => {
        const { onboarding } = get();
        if (!onboarding) throw new Error('No onboarding in progress');
        set({ isLoading: true });
        try {
          const result = await runComplianceCheck(onboarding.formData);
          set({
            onboarding: { ...get().onboarding!, compliance: result, updatedAt: new Date() },
            isLoading: false,
          });
          return result;
        } catch (err) {
          set({ isLoading: false, error: err instanceof Error ? err.message : 'Compliance check failed' });
          throw err;
        }
      },

      configurePayment: (setup) => {
        const { onboarding } = get();
        if (!onboarding) return;
        set({
          onboarding: {
            ...onboarding,
            paymentSetup: { ...setup, configuredAt: new Date() },
            updatedAt: new Date(),
          },
        });
      },

      requestVerification: async () => {
        const { onboarding } = get();
        if (!onboarding) return;
        const deadline = new Date(Date.now() + 7 * 86_400_000).toISOString(); // 7-day timeout
        set({
          onboarding: {
            ...onboarding,
            status: OnboardingStatus.PENDING_REVIEW,
            verificationDeadline: deadline,
            updatedAt: new Date(),
          },
        });
      },

      approveVerification: (tier, notes) => {
        const { onboarding } = get();
        if (!onboarding) return;
        const limits =
          tier === VerificationTier.ENHANCED
            ? { monthlyVolume: 1_000_000, maxTransactions: 10_000 }
            : { monthlyVolume: 10_000, maxTransactions: 100 };
        set({
          onboarding: {
            ...onboarding,
            status: OnboardingStatus.VERIFIED,
            verificationResult: { isVerified: true, tier, reviewedAt: new Date(), reviewerNotes: notes, limits },
            updatedAt: new Date(),
          },
        });
      },

      rejectVerification: (reason) => {
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

      completeWelcomeTour: () => {
        const { onboarding } = get();
        if (!onboarding) return;
        set({ onboarding: { ...onboarding, welcomeTourCompleted: true } });
      },

      getOnboardingStatus: () => get().onboarding?.status ?? OnboardingStatus.NOT_STARTED,

      canResume: () => {
        const { onboarding } = get();
        if (!onboarding) return false;
        if (onboarding.status !== OnboardingStatus.IN_PROGRESS) return false;
        const savedAt = new Date(onboarding.savedAt);
        return Date.now() - savedAt.getTime() <= ONBOARDING_EXPIRY_DAYS * 86_400_000;
      },

      clearOnboarding: () => set({ onboarding: null, error: null }),
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ onboarding: state.onboarding }),
    },
  ),
);
