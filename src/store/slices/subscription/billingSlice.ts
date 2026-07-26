import AsyncStorage from '@react-native-async-storage/async-storage';
import { Subscription } from '../../../types/subscription';
import { ChainType } from '../../../types/wallet';
import { crossChainNotificationService } from '../../../services/crossChainNotificationService';
import { syncRenewalReminders } from '../../../services/notificationService';
import {
  presentChargeSuccessNotification,
  presentDunningRetryNotification,
  presentDunningWarningNotification,
  presentDunningSuspendedNotification,
  presentDunningCancelledNotification,
  presentDunningRecoveryNotification,
} from '../../../services/notificationService';
import { useCalendarStore } from '../../calendarStore';
import { useInvoiceStore } from '../../invoiceStore';
import { advanceBillingDate } from '../../../utils/billingDate';
import { buildBillingPeriod } from '../../../utils/invoice';

export function createSubscriptionBillingSlice(set: any, get: any) {
  return {
    recordBillingOutcome: async (id: string, outcome: 'success' | 'failed') => {
      const sub = get().subscriptions.find((s: Subscription) => s.id === id);
      if (!sub) return;

      if (outcome === 'failed') {
        try {
          const dunningEntriesRaw = await AsyncStorage.getItem('subtrackr-dunning-entries');
          const dunningEntries = JSON.parse(dunningEntriesRaw || '{}');
          const entry = dunningEntries[id];
          const attempt = (entry?.failedAttempts ?? 0) + 1;

          dunningEntries[id] = {
            failedAttempts: attempt,
            lastFailureAt: new Date().toISOString(),
            currentStage:
              attempt <= 3 ? 'retry' : attempt <= 5 ? 'warn' : attempt <= 7 ? 'suspend' : 'cancel',
          };
          await AsyncStorage.setItem('subtrackr-dunning-entries', JSON.stringify(dunningEntries));

          crossChainNotificationService.notifyPaymentFailed(
            id,
            sub.chainType ?? ChainType.EVM,
            sub.chainId ?? 1,
            `Attempt ${attempt}`
          );

          if (sub.notificationsEnabled !== false) {
            if (attempt <= 3) {
              await presentDunningRetryNotification(sub, attempt, 3);
            } else if (attempt <= 5) {
              await presentDunningWarningNotification(sub, attempt);
            } else if (attempt <= 7) {
              await presentDunningSuspendedNotification(sub);
            } else {
              await presentDunningCancelledNotification(sub);
            }
          }

          set({ isLoading: false });
        } catch (error) {
          set({ error, isLoading: false });
        }
        return;
      }

      if (outcome === 'success') {
        try {
          crossChainNotificationService.notifyPaymentSuccess(
            id,
            sub.chainType ?? ChainType.EVM,
            sub.chainId ?? 1,
            sub.price.toString()
          );

          const hasDunningEntry = await AsyncStorage.getItem('subtrackr-dunning-entries');
          if (hasDunningEntry) {
            await AsyncStorage.removeItem('subtrackr-dunning-entries');
            if (sub.notificationsEnabled !== false) {
              await presentDunningRecoveryNotification(sub);
            }
          }

          await presentChargeSuccessNotification(sub);

          const billingPeriod = buildBillingPeriod(sub);
          const next = advanceBillingDate(new Date(sub.nextBillingDate), sub.billingCycle);
          const simulatedGas = 0.01 + Math.random() * 0.005;

          set((state: any) => ({
            subscriptions: state.subscriptions.map((s: Subscription) =>
              s.id === id
                ? {
                    ...s,
                    nextBillingDate: next,
                    updatedAt: new Date(),
                    totalGasSpent: (s.totalGasSpent || 0) + simulatedGas,
                    chargeCount: (s.chargeCount || 0) + 1,
                    lastGasCost: simulatedGas,
                    gasBudget: s.gasBudget || 0.05,
                  }
                : s
            ),
          }));

          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);

          const updatedSubscription = get().subscriptions.find((s: Subscription) => s.id === id);
          if (updatedSubscription) {
            await useCalendarStore.getState().syncSubscriptionToCalendars(updatedSubscription);
          }

          await useInvoiceStore.getState().generateInvoiceFromSubscription(
            {
              subscription: sub,
              period: billingPeriod,
              region: 'GLOBAL',
              currency: sub.currency,
              recipientEmail: `${sub.name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@billing.local`,
            },
            0
          );
        } catch (error) {
          set({ error, isLoading: false });
        }
      }
    },
  };
}
