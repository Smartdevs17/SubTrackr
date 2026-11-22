import { Subscription, SubscriptionStats } from '../types/subscription';

export interface ChurnRiskAssessment {
  subscriptionId: string;
  riskScore: number; // 0-100
  riskLevel: 'low' | 'medium' | 'high';
  predictedRenewal: boolean;
  reason: string;
}

export interface RenewalPredictionEvent {
  subscriptionId: string;
  userId: string;
  predictionScore: number;
  sentAt: Date;
  actionTaken?: 'notified' | 'ignored' | 'renewed';
}

export class RenewalPredictionService {
  /**
   * Assess churn risk based on historical usage patterns
   */
  assessChurnRisk(subscription: Subscription): ChurnRiskAssessment {
    const riskScore = this.calculateRiskScore(subscription);
    const riskLevel = this.getRiskLevel(riskScore);
    const predictedRenewal = riskScore < 60;
    const reason = this.generateReason(subscription, riskScore);

    return {
      subscriptionId: subscription.id,
      riskScore,
      riskLevel,
      predictedRenewal,
      reason,
    };
  }

  private calculateRiskScore(subscription: Subscription): number {
    let score = 50; // baseline

    // Factor 1: Days until renewal (approaching renewal increases risk)
    const daysUntilRenewal = this.getDaysUntilRenewal(subscription.nextBillingDate);
    if (daysUntilRenewal < 7) score += 15;
    else if (daysUntilRenewal < 14) score += 8;
    else if (daysUntilRenewal > 30) score -= 10;

    // Factor 2: Notifications disabled
    if (subscription.notificationsEnabled === false) score += 20;

    // Factor 3: Paused status
    if (subscription.isPaused) score += 25;

    // Factor 4: Long inactive period
    const daysSinceUpdate = this.getDaysSinceUpdate(subscription.updatedAt);
    if (daysSinceUpdate > 60) score += 15;
    else if (daysSinceUpdate > 30) score += 8;

    // Factor 5: High price sensitivity (arbitrary threshold)
    if (subscription.price > 50) score += 5;

    return Math.min(100, Math.max(0, score));
  }

  private getRiskLevel(score: number): 'low' | 'medium' | 'high' {
    if (score < 40) return 'low';
    if (score < 70) return 'medium';
    return 'high';
  }

  private generateReason(subscription: Subscription, riskScore: number): string {
    const reasons: string[] = [];

    if (subscription.notificationsEnabled === false) {
      reasons.push('notifications disabled');
    }

    if (subscription.isPaused) {
      reasons.push('subscription paused');
    }

    const daysSinceUpdate = this.getDaysSinceUpdate(subscription.updatedAt);
    if (daysSinceUpdate > 60) {
      reasons.push('inactive for 60+ days');
    }

    const daysUntilRenewal = this.getDaysUntilRenewal(subscription.nextBillingDate);
    if (daysUntilRenewal < 7) {
      reasons.push('renewal imminent');
    }

    if (reasons.length === 0) {
      reasons.push('routine renewal prediction');
    }

    return reasons.join(', ');
  }

  private getDaysUntilRenewal(nextBillingDate: Date): number {
    const now = new Date();
    const diff = new Date(nextBillingDate).getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  private getDaysSinceUpdate(updatedAt: Date): number {
    const now = new Date();
    const diff = now.getTime() - new Date(updatedAt).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  /**
   * Batch assess multiple subscriptions for churn risk
   */
  batchAssessChurnRisk(subscriptions: Subscription[]): ChurnRiskAssessment[] {
    return subscriptions.map((sub) => this.assessChurnRisk(sub));
  }

  /**
   * Filter subscriptions at high risk of churn
   */
  getHighRiskSubscriptions(subscriptions: Subscription[]): Subscription[] {
    return subscriptions.filter((sub) => {
      const assessment = this.assessChurnRisk(sub);
      return assessment.riskLevel === 'high';
    });
  }

  /**
   * Generate notification payload for at-risk subscription
   */
  generateNotificationPayload(assessment: ChurnRiskAssessment): {
    title: string;
    body: string;
    priority: 'high' | 'normal';
  } {
    const priorityMap = {
      low: 'normal',
      medium: 'normal',
      high: 'high',
    } as const;

    return {
      title: `Renew your subscription?`,
      body: `We've noticed you might cancel. Here's why: ${assessment.reason}`,
      priority: priorityMap[assessment.riskLevel],
    };
  }
}

export const renewalPredictionService = new RenewalPredictionService();
