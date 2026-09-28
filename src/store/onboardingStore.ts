import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface TourStep {
  id: string;
  title: string;
  description: string;
  targetElementId?: string;
}

export const DEFAULT_ONBOARDING_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to SubTrackr!',
    description: 'Track all your subscriptions and recurring payments in one central place.',
  },
  {
    id: 'add-subscription',
    title: 'Add Subscriptions',
    description: 'Easily add your active software, streaming, or utility subscriptions.',
  },
  {
    id: 'analytics-dashboard',
    title: 'Revenue & Cost Analytics',
    description: 'Visualize your monthly and annual spending with interactive charts.',
  },
  {
    id: 'alerts-notifications',
    title: 'Smart Payment Alerts',
    description: 'Get notified before renewal dates so you never pay for unused services.',
  },
];

export interface OnboardingState {
  steps: TourStep[];
  currentStepIndex: number;
  isActive: boolean;
  isCompleted: boolean;
  isSkipped: boolean;
  startTour: (customSteps?: TourStep[]) => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => void;
  finishTour: () => void;
  resetTour: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      steps: DEFAULT_ONBOARDING_STEPS,
      currentStepIndex: 0,
      isActive: false,
      isCompleted: false,
      isSkipped: false,

      startTour: (customSteps) => {
        set({
          steps: customSteps && customSteps.length > 0 ? customSteps : DEFAULT_ONBOARDING_STEPS,
          currentStepIndex: 0,
          isActive: true,
          isCompleted: false,
          isSkipped: false,
        });
      },

      nextStep: () => {
        const { currentStepIndex, steps } = get();
        if (currentStepIndex < steps.length - 1) {
          set({ currentStepIndex: currentStepIndex + 1 });
        } else {
          set({ isActive: false, isCompleted: true });
        }
      },

      prevStep: () => {
        const { currentStepIndex } = get();
        if (currentStepIndex > 0) {
          set({ currentStepIndex: currentStepIndex - 1 });
        }
      },

      skipTour: () => {
        set({ isActive: false, isSkipped: true });
      },

      finishTour: () => {
        set({ isActive: false, isCompleted: true });
      },

      resetTour: () => {
        set({
          steps: DEFAULT_ONBOARDING_STEPS,
          currentStepIndex: 0,
          isActive: false,
          isCompleted: false,
          isSkipped: false,
        });
      },
    }),
    {
      name: 'subtrackr-onboarding-store',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
