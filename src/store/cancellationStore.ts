import { create } from 'zustand';

export type CancellationStep = 'REASON' | 'OFFERS' | 'CONFIRM' | 'SUCCESS';

interface CancellationState {
  currentStep: CancellationStep;
  reason: string | null;
  selectedOfferId: string | null;

  setStep: (step: CancellationStep) => void;
  setReason: (reason: string) => void;
  acceptOffer: (offerId: string) => Promise<void>;
  reset: () => void;
}

export const useCancellationStore = create<CancellationState>((set) => ({
  currentStep: 'REASON',
  reason: null,
  selectedOfferId: null,

  setStep: (step) => set({ currentStep: step }),
  setReason: (reason) => set({ reason, currentStep: 'OFFERS' }),

  acceptOffer: async (offerId) => {
    // Logic to call apply_retention_offer on Soroban
    set({ selectedOfferId: offerId, currentStep: 'SUCCESS' });
  },

  reset: () => set({ currentStep: 'REASON', reason: null, selectedOfferId: null }),
}));
