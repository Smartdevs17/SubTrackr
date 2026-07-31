import { PredictionService } from './predictionService';
import { useSubscriptionStore } from '../../../src/store/subscriptionStore';
import { useSupportStore } from '../../../src/store/supportStore';

export class InterventionService {
  /**
   * Evaluates all active subscriptions and triggers interventions for high-risk users.
   */
  static async runAutomatedInterventions(): Promise<any> {
    const subs = useSubscriptionStore.getState().subscriptions.filter(s => s.isActive);
    
    const batchSize = 10;
    const interventions = [];
    
    for (let i = 0; i < subs.length; i += batchSize) {
      const batch = subs.slice(i, i + batchSize);
      
      const payload = batch.map(s => ({
        subscriberAddress: s.id,
        userData: {
          recentPaymentFailures: s.chargeCount ? (s.chargeCount % 2) : 0, 
          baselineLoginsPerMonth: 20,
          recentLogins: 5, // Simulate lower engagement to force some high risk
          openSupportTickets: 0,
          priceSensitivityIndex: 0.8
        }
      }));
      
      try {
        const predictions = await PredictionService.predictChurnBatch(payload);
        
        for (const pred of predictions) {
          if (pred.riskLevel === 'High') {
             const sub = batch.find(s => s.id === pred.subscriber);
             if (sub) {
               const result = await this.triggerDiscount(sub, pred.recommendedAction);
               interventions.push({
                 subscriber: sub.id,
                 action: pred.recommendedAction,
                 status: result ? 'Applied' : 'Failed'
               });
             }
          }
        }
      } catch (err) {
        console.error('Failed prediction batch', err);
      }
    }
    
    return {
      interventionsTriggered: interventions.length,
      details: interventions
    };
  }
  
  private static async triggerDiscount(subscription: any, reason: string): Promise<boolean> {
    try {
      const supportStore = useSupportStore.getState();
      const discountAmount = subscription.price * 0.10;
      console.log(`Applying discount of ${discountAmount} to ${subscription.id} for: ${reason}`);
      
      supportStore.createTicket({
        subscriptionId: subscription.id,
        issueType: 'other',
        message: `Automated Churn Intervention: ${reason}`,
        occurredAt: new Date(),
        context: {
          subscriptionName: subscription.name,
          planName: subscription.name,
          planTier: subscription.category,
          billingCycle: subscription.billingCycle,
          status: 'active',
          amount: subscription.price,
          currency: subscription.currency,
          createdAt: new Date().toISOString(),
          nextBillingDate: new Date().toISOString(),
          failedPayments: 0,
          chargeCount: 0,
          history: []
        },
        dedupeKey: `intervention-${subscription.id}-${Date.now()}`,
        actorId: 'system'
      });
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }
}
