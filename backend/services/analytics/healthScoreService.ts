/**
 * Subscription Health Score Service
 *
 * Computes a composite health score (0-100) for each subscription
 * based on multiple weighted factors:
 *   - Payment reliability (40%)
 *   - Usage engagement (25%)
 *   - Tenure/loyalty (15%)
 *   - Support burden (10%)
 *   - Plan utilization (10%)
 *
 * Closes #1150
 */

export interface HealthScoreInput {
  subscriptionId: string;
  userId: string;
  planName: string;
  // Payment metrics
  totalPayments: number;
  failedPayments: number;
  // Usage metrics
  monthlyActiveDays: number; // 0-30
  totalDaysInPeriod: number;
  // Tenure
  subscriptionAgeDays: number;
  // Support
  openSupportTickets: number;
  totalSupportTickets: number;
  // Plan utilization
  planLimit: number; // e.g., API calls, seats, etc.
  currentUsage: number;
  // Optional: last login days ago
  daysSinceLastLogin?: number;
}

export interface HealthFactor {
  name: string;
  score: number;
  weight: number;
  weightedScore: number;
  status: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  detail: string;
}

export interface HealthScoreResult {
  subscriptionId: string;
  userId: string;
  planName: string;
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  status: 'healthy' | 'at-risk' | 'critical' | 'churning';
  factors: HealthFactor[];
  recommendation: string;
  computedAt: Date;
}

export interface HealthScoreSummary {
  totalSubscriptions: number;
  averageScore: number;
  gradeDistribution: Record<string, number>;
  statusDistribution: Record<string, number>;
  atRiskCount: number;
  criticalCount: number;
  healthyCount: number;
}

export class HealthScoreService {
  // Weights must sum to 1.0
  private static readonly WEIGHTS = {
    paymentReliability: 0.40,
    usageEngagement: 0.25,
    tenure: 0.15,
    supportBurden: 0.10,
    planUtilization: 0.10,
  };

  /**
   * Compute the health score for a single subscription.
   */
  computeHealthScore(input: HealthScoreInput): HealthScoreResult {
    const factors: HealthFactor[] = [
      this.computePaymentReliability(input),
      this.computeUsageEngagement(input),
      this.computeTenure(input),
      this.computeSupportBurden(input),
      this.computePlanUtilization(input),
    ];

    const overallScore = Math.round(
      factors.reduce((sum, f) => sum + f.weightedScore, 0),
    );

    const grade = this.scoreToGrade(overallScore);
    const status = this.scoreToStatus(overallScore);
    const recommendation = this.generateRecommendation(overallScore, factors);

    return {
      subscriptionId: input.subscriptionId,
      userId: input.userId,
      planName: input.planName,
      overallScore: Math.max(0, Math.min(100, overallScore)),
      grade,
      status,
      factors,
      recommendation,
      computedAt: new Date(),
    };
  }

  /**
   * Compute health scores for multiple subscriptions in batch.
   */
  computeBatch(inputs: HealthScoreInput[]): HealthScoreResult[] {
    return inputs.map((input) => this.computeHealthScore(input));
  }

  /**
   * Generate a summary of health scores across all subscriptions.
   */
  generateSummary(results: HealthScoreResult[]): HealthScoreSummary {
    if (results.length === 0) {
      return {
        totalSubscriptions: 0,
        averageScore: 0,
        gradeDistribution: {},
        statusDistribution: {},
        atRiskCount: 0,
        criticalCount: 0,
        healthyCount: 0,
      };
    }

    const totalScore = results.reduce((sum, r) => sum + r.overallScore, 0);
    const averageScore = Math.round(totalScore / results.length);

    const gradeDistribution: Record<string, number> = {};
    const statusDistribution: Record<string, number> = {};

    for (const result of results) {
      gradeDistribution[result.grade] = (gradeDistribution[result.grade] || 0) + 1;
      statusDistribution[result.status] = (statusDistribution[result.status] || 0) + 1;
    }

    return {
      totalSubscriptions: results.length,
      averageScore,
      gradeDistribution,
      statusDistribution,
      atRiskCount: statusDistribution['at-risk'] || 0,
      criticalCount: (statusDistribution['critical'] || 0) + (statusDistribution['churning'] || 0),
      healthyCount: statusDistribution['healthy'] || 0,
    };
  }

  // --- Individual factor computations ---

  private computePaymentReliability(input: HealthScoreInput): HealthFactor {
    const { totalPayments, failedPayments } = input;
    const weight = HealthScoreService.WEIGHTS.paymentReliability;

    if (totalPayments === 0) {
      return {
        name: 'Payment Reliability',
        score: 0,
        weight,
        weightedScore: 0,
        status: 'critical',
        detail: 'No payment history',
      };
    }

    const successRate = (totalPayments - failedPayments) / totalPayments;
    const score = Math.round(successRate * 100);

    return {
      name: 'Payment Reliability',
      score,
      weight,
      weightedScore: score * weight,
      status: this.scoreToFactorStatus(score),
      detail: `${totalPayments - failedPayments}/${totalPayments} payments successful (${score}%)`,
    };
  }

  private computeUsageEngagement(input: HealthScoreInput): HealthFactor {
    const { monthlyActiveDays, totalDaysInPeriod, daysSinceLastLogin } = input;
    const weight = HealthScoreService.WEIGHTS.usageEngagement;

    const activeDays = Math.min(monthlyActiveDays, totalDaysInPeriod);
    const engagementRate = totalDaysInPeriod > 0 ? activeDays / totalDaysInPeriod : 0;
    let score = Math.round(engagementRate * 100);

    // Penalize if last login was long ago
    if (daysSinceLastLogin !== undefined) {
      if (daysSinceLastLogin > 30) score *= 0.3;
      else if (daysSinceLastLogin > 14) score *= 0.6;
      else if (daysSinceLastLogin > 7) score *= 0.8;
    }

    score = Math.round(score);

    return {
      name: 'Usage Engagement',
      score,
      weight,
      weightedScore: score * weight,
      status: this.scoreToFactorStatus(score),
      detail: `${activeDays}/${totalDaysInPeriod} active days${daysSinceLastLogin !== undefined ? `, last login ${daysSinceLastLogin}d ago` : ''}`,
    };
  }

  private computeTenure(input: HealthScoreInput): HealthFactor {
    const { subscriptionAgeDays } = input;
    const weight = HealthScoreService.WEIGHTS.tenure;

    // Score increases with tenure, maxing out at 365 days
    const score = Math.min(Math.round((subscriptionAgeDays / 365) * 100), 100);

    return {
      name: 'Tenure / Loyalty',
      score,
      weight,
      weightedScore: score * weight,
      status: this.scoreToFactorStatus(score),
      detail: `${Math.round(subscriptionAgeDays / 30)} months subscribed`,
    };
  }

  private computeSupportBurden(input: HealthScoreInput): HealthFactor {
    const { openSupportTickets, totalSupportTickets } = input;
    const weight = HealthScoreService.WEIGHTS.supportBurden;

    // Open tickets are more impactful than resolved ones
    let score = 100;
    score -= openSupportTickets * 15;
    score -= totalSupportTickets * 3;
    score = Math.max(0, Math.min(100, score));

    return {
      name: 'Support Burden',
      score,
      weight,
      weightedScore: score * weight,
      status: this.scoreToFactorStatus(score),
      detail: `${openSupportTickets} open, ${totalSupportTickets} total tickets`,
    };
  }

  private computePlanUtilization(input: HealthScoreInput): HealthFactor {
    const { planLimit, currentUsage } = input;
    const weight = HealthScoreService.WEIGHTS.planUtilization;

    if (planLimit === 0) {
      return {
        name: 'Plan Utilization',
        score: 50,
        weight,
        weightedScore: 50 * weight,
        status: 'fair',
        detail: 'No usage limit defined',
      };
    }

    const utilizationRate = currentUsage / planLimit;
    // Optimal utilization is 50-90%, too low or too high is penalized
    let score: number;
    if (utilizationRate < 0.1) {
      score = 30; // Underutilized
    } else if (utilizationRate < 0.5) {
      score = 60;
    } else if (utilizationRate <= 0.9) {
      score = 100; // Optimal
    } else if (utilizationRate <= 1.0) {
      score = 80; // Near limit
    } else {
      score = 50; // Over limit
    }

    return {
      name: 'Plan Utilization',
      score,
      weight,
      weightedScore: score * weight,
      status: this.scoreToFactorStatus(score),
      detail: `${currentUsage}/${planLimit} (${Math.round(utilizationRate * 100)}%)`,
    };
  }

  // --- Helper methods ---

  private scoreToGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  private scoreToStatus(score: number): 'healthy' | 'at-risk' | 'critical' | 'churning' {
    if (score >= 75) return 'healthy';
    if (score >= 60) return 'at-risk';
    if (score >= 40) return 'critical';
    return 'churning';
  }

  private scoreToFactorStatus(score: number): HealthFactor['status'] {
    if (score >= 85) return 'excellent';
    if (score >= 70) return 'good';
    if (score >= 50) return 'fair';
    if (score >= 30) return 'poor';
    return 'critical';
  }

  private generateRecommendation(score: number, factors: HealthFactor[]): string {
    if (score >= 75) {
      return 'Subscription is healthy. Continue current engagement strategies.';
    }

    // Find the worst factor
    const worstFactor = factors.reduce((worst, f) =>
      f.score < worst.score ? f : worst,
    );

    if (worstFactor.name === 'Payment Reliability') {
      return 'Address payment failures immediately. Consider updating payment method or offering a grace period.';
    }
    if (worstFactor.name === 'Usage Engagement') {
      return 'Engagement is low. Send re-engagement campaigns and feature highlights to increase usage.';
    }
    if (worstFactor.name === 'Support Burden') {
      return 'High support burden detected. Resolve open tickets and proactively address common issues.';
    }
    if (worstFactor.name === 'Plan Utilization') {
      return 'Plan utilization is suboptimal. Consider plan upgrade or downgrade recommendations.';
    }
    if (worstFactor.name === 'Tenure / Loyalty') {
      return 'New subscription. Focus on onboarding and early value demonstration to build loyalty.';
    }

    return 'Monitor subscription closely and take proactive retention measures.';
  }
}

export const healthScoreService = new HealthScoreService();
