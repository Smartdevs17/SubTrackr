import { Subscription } from '../../../types/subscription';
import { SubscriptionChange } from '../../../types/subscription';
import { SubscriptionCRDT } from '../../../services/cache/crdt';
import { networkMonitor } from '../../../services/network/networkMonitor';
import { syncRenewalReminders } from '../../../services/notificationService';
import { previewProration } from '../../../utils/proration';
import { applyCreditMemo, generateCreditMemo } from '../../../utils/proration';
import { advanceBillingDate } from '../../../utils/billingDate';
import { errorHandler } from '../../../services/errorHandler';

export const initialSubscriptionPlanState = {
  prorationPreview: null as unknown,
  creditMemos: {} as Record<string, unknown>,
  planChanges: [] as SubscriptionChange[],
};

export function createSubscriptionPlanSlice(set: any, get: any) {
  return {
    ...initialSubscriptionPlanState,

    previewPlanChange: (
      id: string,
      newPrice: number,
      effectiveDate: 'immediate' | 'end_of_period'
    ) => {
      const sub = get().subscriptions.find((s: Subscription) => s.id === id);
      if (!sub) {
        throw new Error('Subscription not found');
      }

      const preview = previewProration(sub, newPrice, effectiveDate);
      set({ prorationPreview: preview });
      return preview;
    },

    executePlanChange: async (
      id: string,
      newPlanData: Partial<Subscription>,
      effectiveDate: 'immediate' | 'end_of_period'
    ) => {
      set({ isLoading: true, error: null });
      try {
        const sub = get().subscriptions.find((s: Subscription) => s.id === id);
        if (!sub) throw new Error('Subscription not found');

        const preview = previewProration(
          sub,
          newPlanData.price ?? sub.price,
          effectiveDate === 'end_of_period' ? 'end_of_period' : 'immediate'
        );

        const updatedCreditMemos = { ...get().creditMemos };
        if (preview.isCredit && preview.amount > 0) {
          const memo = generateCreditMemo(id, preview.amount, preview.description);
          updatedCreditMemos[id] = memo;
        }

        const updates: Partial<Subscription> = {
          ...newPlanData,
          updatedAt: new Date(),
        };

        if (effectiveDate === 'immediate') {
          updates.nextBillingDate = advanceBillingDate(
            new Date(),
            newPlanData.billingCycle ?? sub.billingCycle
          );
        }

        const timestamp = Date.now();
        const currentMeta =
          (get().crdtMetadata || {})[id] ?? SubscriptionCRDT.createMetadata(sub, timestamp - 1000);
        const updatedMetadata = SubscriptionCRDT.updateMetadata(currentMeta, updates, timestamp);

        set((state: any) => ({
          subscriptions: state.subscriptions.map((s: Subscription) =>
            s.id === id ? { ...s, ...updates } : s
          ),
          crdtMetadata: { ...state.crdtMetadata, [id]: updatedMetadata },
          syncStatus: 'pending',
          creditMemos: updatedCreditMemos,
          prorationPreview: null,
          isLoading: false,
        }));

        get().calculateStats();
        await syncRenewalReminders(get().subscriptions);

        if (networkMonitor.isOnline()) {
          await get().syncWithServer();
        }
      } catch (error) {
        const appError = errorHandler.handleError(error as Error, {
          action: 'executePlanChange',
          subscriptionId: id,
        });
        set({ error: appError, isLoading: false });
      }
    },

    applyCreditToSubscription: async (id: string) => {
      const sub = get().subscriptions.find((s: Subscription) => s.id === id);
      const memo = get().creditMemos[id];
      if (!sub || !memo || memo.applied) return;

      const { updatedMemo } = applyCreditMemo(sub.price, memo);

      set((state: any) => ({
        creditMemos: {
          ...state.creditMemos,
          [id]: updatedMemo,
        },
      }));
    },

    queuePlanChange: (id: string, newPlanData: Partial<Subscription>, effectiveDate: string) => {
      const sub = get().subscriptions.find((s: Subscription) => s.id === id);
      if (!sub) throw new Error('Subscription not found');
      const preview = previewProration(
        sub,
        newPlanData.price ?? sub.price,
        effectiveDate === 'end_of_period' ? 'end_of_period' : 'immediate'
      );

      const change: SubscriptionChange = {
        id: Date.now().toString(36) + Math.random().toString(36).substring(2, 8),
        subscriptionId: id,
        fromPrice: sub.price,
        toPrice: newPlanData.price ?? sub.price,
        effectiveType: effectiveDate as any,
        status: 'pending',
        proration: preview,
        createdAt: new Date(),
        newPlanData,
      };

      set((state: any) => ({
        planChanges: [...(state.planChanges || []), change],
      }));
    },

    approvePlanChange: async (changeId: string) => {
      const change = (get().planChanges || []).find((c: SubscriptionChange) => c.id === changeId);
      if (!change) throw new Error('Change request not found');
      if (change.status !== 'pending') throw new Error('Change request is not pending');

      await get().executePlanChange(
        change.subscriptionId,
        change.newPlanData,
        change.effectiveType === 'end_of_period' ? 'end_of_period' : 'immediate'
      );

      set((state: any) => ({
        planChanges: (state.planChanges || []).map((c: SubscriptionChange) =>
          c.id === changeId ? { ...c, status: 'executed' } : c
        ),
      }));
    },

    rejectPlanChange: (changeId: string) => {
      set((state: any) => ({
        planChanges: (state.planChanges || []).map((c: SubscriptionChange) =>
          c.id === changeId ? { ...c, status: 'rejected' } : c
        ),
      }));
    },

    getChangeHistory: (subscriptionId: string) => {
      return (get().planChanges || []).filter(
        (c: SubscriptionChange) => c.subscriptionId === subscriptionId
      );
    },
  };
}
