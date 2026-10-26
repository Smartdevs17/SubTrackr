import { BillingEngine } from './billingEngine';

export interface TrialAnalytics {
  totalTrials: number;
  convertedTrials: number;
  conversionRate: number;
}

export interface WebhookPayload {
  event: string;
  subscriptionId: number;
  data: any;
}

export class TrialManagementService {
  constructor(private webhookUrl?: string) {}

  /**
   * Checks subscriptions nearing their trial end date and triggers a webhook event.
   * This handles the conversion optimization logic (e.g. reminders/discounts).
   */
  public checkTrialsEndingSoon(
    subscriptions: any[],
    warningThresholdDays: number = 3
  ): WebhookPayload[] {
    const alerts: WebhookPayload[] = [];
    const now = Date.now();
    const thresholdMs = warningThresholdDays * 24 * 60 * 60 * 1000;

    for (const sub of subscriptions) {
      if (sub.status === 'Trialing' || sub.status === 4 /* Trialing Enum */) {
        const timeRemaining = (sub.nextChargeAt || sub.next_charge_at) * 1000 - now;

        if (timeRemaining > 0 && timeRemaining <= thresholdMs) {
          const payload: WebhookPayload = {
            event: 'trial_ending_soon',
            subscriptionId: sub.id,
            data: {
              timeRemainingDays: Math.ceil(timeRemaining / (24 * 60 * 60 * 1000)),
            },
          };
          alerts.push(payload);
          this.triggerWebhook(payload);
        }
      }
    }

    return alerts;
  }

  /**
   * Evaluates expired trials and triggers conversion logic.
   */
  public processExpiredTrials(subscriptions: any[]): number[] {
    const convertedIds: number[] = [];
    const now = Date.now();

    for (const sub of subscriptions) {
      if (sub.status === 'Trialing' || sub.status === 4 /* Trialing Enum */) {
        const endTimeMs = (sub.nextChargeAt || sub.next_charge_at) * 1000;

        if (now >= endTimeMs) {
          // In a real system, we would trigger a charge here via BillingEngine.
          // For now, we return the IDs to be converted.
          convertedIds.push(sub.id);
        }
      }
    }

    return convertedIds;
  }

  /**
   * Calculates trial conversion metrics.
   */
  public getTrialAnalytics(
    totalHistoricalTrials: number,
    totalConverted: number
  ): TrialAnalytics {
    return {
      totalTrials: totalHistoricalTrials,
      convertedTrials: totalConverted,
      conversionRate:
        totalHistoricalTrials > 0
          ? totalConverted / totalHistoricalTrials
          : 0,
    };
  }

  private triggerWebhook(payload: WebhookPayload) {
    if (this.webhookUrl) {
      // Mock webhook dispatch
      console.log(`[Webhook Dispatch] ${this.webhookUrl} ->`, payload);
    }
  }
}
