import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import { Subscription } from '../types/subscription';
import {
  AlignmentHistoryEntry,
  AlignmentPlanPreview,
  AlignmentTargetDay,
  ConsolidationGroup,
} from '../types/billingAlignment';
import {
  buildAlignmentPlanPreview,
  buildHistoryEntry,
  canRealign,
  daysUntilNextRealignment,
  groupForConsolidation,
} from '../utils/billingAlignment';
import { errorHandler } from '../services/errorHandler';

interface BillingAlignmentState {
  lastAlignedAt: Date | null;
  history: AlignmentHistoryEntry[];
  isLoading: boolean;
  error: string | null;

  previewAlignment: (
    subscriptions: Subscription[],
    targetDay: AlignmentTargetDay
  ) => AlignmentPlanPreview;
  /** Records the alignment in history. Callers must separately update each subscription's nextBillingDate. */
  confirmAlignment: (preview: AlignmentPlanPreview) => boolean;
  canRealign: () => boolean;
  daysUntilNextRealignment: () => number;
  getConsolidationGroups: (subscriptions: Subscription[]) => ConsolidationGroup[];
  clearError: () => void;
}

export const useBillingAlignmentStore = create<BillingAlignmentState>()(
  persist(
    (set, get) => ({
      lastAlignedAt: null,
      history: [],
      isLoading: false,
      error: null,

      previewAlignment: (subscriptions, targetDay) => {
        return buildAlignmentPlanPreview(subscriptions, targetDay);
      },

      confirmAlignment: (preview) => {
        if (!canRealign(get().lastAlignedAt)) {
          set({ error: 'Re-alignment is locked — you can only realign once every 90 days.' });
          return false;
        }
        try {
          const billableIds = preview.previews
            .filter((p) => !p.excludedReason)
            .map((p) => p.subscriptionId);
          const now = new Date();
          const entry = buildHistoryEntry(preview.targetDay, billableIds, now);
          set((state) => ({
            lastAlignedAt: now,
            history: [entry, ...state.history],
            error: null,
          }));
          return true;
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, { action: 'confirmAlignment' });
          set({ error: appError.userMessage });
          return false;
        }
      },

      canRealign: () => canRealign(get().lastAlignedAt),

      daysUntilNextRealignment: () => daysUntilNextRealignment(get().lastAlignedAt),

      getConsolidationGroups: (subscriptions) => groupForConsolidation(subscriptions),

      clearError: () => set({ error: null }),
    }),
    {
      name: 'subtrackr-billing-alignment-store',
      storage: createJSONStorage(() => asyncStorageAdapter),
    }
  )
);
