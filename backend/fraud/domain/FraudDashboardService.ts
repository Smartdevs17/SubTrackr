/**
 * FraudDashboardService
 *
 * Aggregates data from the RuleEngine, FraudInvestigationService, and the
 * client-side fraudDetectionService to produce a unified dashboard payload
 * suitable for both the backend API and the React Native FraudDashboard screen.
 *
 * Responsibilities:
 *  - Merge on-chain risk scores with in-process rule-engine scores
 *  - Build KPI summary metrics (totalChecks, blocked, flagged, etc.)
 *  - Expose the review queue with prioritised ordering
 *  - Compute false-positive rate and model confidence from feedback
 *  - Generate per-merchant fraud reports
 *  - Surface the signal feed (latest assessments)
 */

import { RuleEngine } from './RuleEngine';
import { FraudInvestigationService } from './FraudInvestigationService';
import type { FraudTransaction, FraudContext } from './rules/FraudRule';
import type { ScorerResult } from './Scorer';
import type { FraudCase, FraudAction, FraudReviewOutcome, FraudRiskScore } from '../../../src/types/fraud';

// ── Dashboard types ───────────────────────────────────────────────────────────

export interface FraudDashboardAnalytics {
  totalChecks: number;
  approved: number;
  flagged: number;
  blocked: number;
  avgRisk: number;
  velocityAlerts: number;
  anomalyAlerts: number;
  geoAnomalyAlerts: number;
  chargebackPredictions: number;
  falsePositiveRate: number;
  modelConfidence: number;
  manualReviewsClosed: number;
}

export interface ReviewQueueItem {
  caseId: string;
  subscriptionId: string;
  subscriberId: string;
  merchantId: string;
  merchantName: string;
  subscriptionName: string;
  riskScore: number;
  action: FraudAction;
  reason: string;
  outcome?: FraudReviewOutcome;
  evidence?: Array<{ evidenceId: string; label: string; value: string }>;
}

export interface SubscriptionRiskItem {
  id: string;
  subscriptionId: string;
  subscriptionName: string;
  subscriberId: string;
  merchantId: string;
  merchantName: string;
  amount: number;
  currency: string;
  riskScore: number;
  action: FraudAction;
  signals: Array<{ kind: string; score: number; observedAt: number }>;
}

export interface AssessmentFeedItem {
  subscriptionId: string;
  merchantName: string;
  reason: string;
  action: FraudAction;
  assessedAt: number;
  signals: Array<{ kind: string; score: number; observedAt: number }>;
}

export interface MerchantFraudReport {
  merchantId: string;
  merchantName: string;
  totalSubscriptions: number;
  flaggedSubscriptions: number;
  blockedSubscriptions: number;
  manualReviewCount: number;
  averageRisk: number;
  velocityAlerts: number;
  anomalyAlerts: number;
  chargebackPredictions: number;
  geolocationAlerts: number;
  pendingEvidenceCount: number;
}

export interface FraudDashboardPayload {
  analytics: FraudDashboardAnalytics;
  reviewQueue: ReviewQueueItem[];
  subscriptions: SubscriptionRiskItem[];
  assessments: AssessmentFeedItem[];
  merchants: Array<{ id: string; name: string }>;
}

// ── Internal tracked score ────────────────────────────────────────────────────

interface TrackedScore {
  subscriptionId: string;
  subscriberId: string;
  merchantId: string;
  merchantName: string;
  subscriptionName: string;
  amount: number;
  currency: string;
  score: ScorerResult;
  assessedAt: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class FraudDashboardService {
  private scores: TrackedScore[] = [];
  private falsePositiveFeedback: Array<{ subscriptionId: string; reason: string }> = [];
  private engine: RuleEngine;
  private investigations: FraudInvestigationService;

  constructor(
    engine: RuleEngine = new RuleEngine(),
    investigations: FraudInvestigationService = new FraudInvestigationService()
  ) {
    this.engine = engine;
    this.investigations = investigations;
  }

  // ── Risk assessment ─────────────────────────────────────────────────────────

  /**
   * Evaluate a subscription's fraud risk using the rule engine.
   * Records the result for dashboard aggregation.
   */
  assessRisk(
    transaction: FraudTransaction,
    context: FraudContext,
    meta: {
      subscriptionId: string;
      merchantName: string;
      subscriptionName: string;
      amount: number;
      currency: string;
    }
  ): ScorerResult {
    const result = this.engine.evaluate(transaction, context);

    const tracked: TrackedScore = {
      subscriptionId: meta.subscriptionId,
      subscriberId: transaction.subscriberId,
      merchantId: transaction.merchantId,
      merchantName: meta.merchantName,
      subscriptionName: meta.subscriptionName,
      amount: meta.amount,
      currency: meta.currency,
      score: result,
      assessedAt: Date.now(),
    };

    // Replace previous score for the same subscription
    const existingIdx = this.scores.findIndex(
      (s) => s.subscriptionId === meta.subscriptionId
    );
    if (existingIdx >= 0) {
      this.scores[existingIdx] = tracked;
    } else {
      this.scores.push(tracked);
    }

    // Automatically open an investigation case for flagged / blocked subscriptions
    if (result.action !== 'approve') {
      const riskScore: FraudRiskScore = {
        subscriberId: transaction.subscriberId,
        subscriptionId: meta.subscriptionId,
        merchantId: transaction.merchantId,
        merchantName: meta.merchantName,
        totalScore: result.totalScore,
        velocityScore: 0,
        anomalyScore: 0,
        chargebackScore: 0,
        action: result.action,
        reason: result.reason,
        assessedAt: new Date().toISOString(),
        signals: [],
        evidence: result.scoredRules
          .filter((r) => r.triggered)
          .map((r) => ({
            evidenceId: r.ruleName,
            source: 'payment' as const,
            label: r.ruleName,
            value: String(r.rawScore),
            capturedAt: new Date().toISOString(),
            confidence: Math.min(100, r.rawScore),
          })),
      };
      this.investigations.openCaseFromAssessment(riskScore);
    }

    return result;
  }

  // ── Feedback ────────────────────────────────────────────────────────────────

  /** Record a false-positive feedback signal from a reviewer. */
  submitFalsePositiveFeedback(subscriptionId: string, reason: string): void {
    this.falsePositiveFeedback.push({ subscriptionId, reason });
  }

  // ── Dashboard payload ────────────────────────────────────────────────────────

  /** Build the full dashboard payload. */
  getDashboardPayload(): FraudDashboardPayload {
    const analytics = this._buildAnalytics();
    const reviewQueue = this._buildReviewQueue();
    const subscriptions = this._buildSubscriptionList();
    const assessments = this._buildAssessmentFeed();
    const merchantSet = new Map<string, string>();
    for (const s of this.scores) {
      merchantSet.set(s.merchantId, s.merchantName);
    }
    const merchants = Array.from(merchantSet.entries()).map(([id, name]) => ({ id, name }));

    return { analytics, reviewQueue, subscriptions, assessments, merchants };
  }

  /** Build a per-merchant fraud report. */
  getMerchantFraudReport(merchantId: string, merchantName: string): MerchantFraudReport {
    const merchantScores = this.scores.filter((s) => s.merchantId === merchantId);
    const { cases } = this.investigations.getCases({ merchantId });

    let flaggedSubscriptions = 0;
    let blockedSubscriptions = 0;
    let totalRisk = 0;
    let velocityAlerts = 0;
    let anomalyAlerts = 0;
    let chargebackPredictions = 0;
    let geolocationAlerts = 0;
    const pendingEvidenceCount = cases.filter((c) => c.status === 'pending').length;

    for (const tracked of merchantScores) {
      const { score } = tracked;
      totalRisk += score.totalScore;
      if (score.action === 'flag' || score.action === 'block') flaggedSubscriptions++;
      if (score.action === 'block') blockedSubscriptions++;

      for (const rule of score.scoredRules.filter((r) => r.triggered)) {
        const name = rule.ruleName.toLowerCase();
        if (name.includes('velocity')) velocityAlerts++;
        if (name.includes('anomaly') || name.includes('usage')) anomalyAlerts++;
        if (name.includes('chargeback')) chargebackPredictions++;
        if (name.includes('geo')) geolocationAlerts++;
      }
    }

    return {
      merchantId,
      merchantName,
      totalSubscriptions: merchantScores.length,
      flaggedSubscriptions,
      blockedSubscriptions,
      manualReviewCount: cases.filter((c) => c.status === 'pending' || c.status === 'escalated')
        .length,
      averageRisk:
        merchantScores.length > 0 ? Math.round(totalRisk / merchantScores.length) : 0,
      velocityAlerts,
      anomalyAlerts,
      chargebackPredictions,
      geolocationAlerts,
      pendingEvidenceCount,
    };
  }

  // ── Case management passthrough ─────────────────────────────────────────────

  approveSubscription(subscriptionId: string): void {
    const { cases } = this.investigations.getCases();
    const openCase = cases.find((c) => c.subscriptionId === subscriptionId);
    if (openCase) {
      this.investigations.resolveCase(openCase.caseId, 'legitimate');
    }
  }

  blockSubscription(subscriptionId: string): void {
    const { cases } = this.investigations.getCases();
    const openCase = cases.find((c) => c.subscriptionId === subscriptionId);
    if (openCase) {
      this.investigations.resolveCase(openCase.caseId, 'confirmed_fraud');
    }
  }

  resolveCase(subscriptionId: string, outcome: FraudReviewOutcome): void {
    const { cases } = this.investigations.getCases();
    const openCase = cases.find((c) => c.subscriptionId === subscriptionId);
    if (openCase) {
      this.investigations.resolveCase(openCase.caseId, outcome);
    }
  }

  getInvestigationService(): FraudInvestigationService {
    return this.investigations;
  }

  getRuleEngine(): RuleEngine {
    return this.engine;
  }

  // ── Reset ────────────────────────────────────────────────────────────────────

  reset(): void {
    this.scores = [];
    this.falsePositiveFeedback = [];
    this.investigations.reset();
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private _buildAnalytics(): FraudDashboardAnalytics {
    let approved = 0;
    let flagged = 0;
    let blocked = 0;
    let totalRisk = 0;
    let velocityAlerts = 0;
    let anomalyAlerts = 0;
    let geoAnomalyAlerts = 0;
    let chargebackPredictions = 0;

    for (const tracked of this.scores) {
      const { score } = tracked;
      totalRisk += score.totalScore;
      if (score.action === 'approve') approved++;
      else if (score.action === 'flag') flagged++;
      else if (score.action === 'block') blocked++;

      for (const rule of score.scoredRules.filter((r) => r.triggered)) {
        const name = rule.ruleName.toLowerCase();
        if (name.includes('velocity')) velocityAlerts++;
        if (name.includes('anomaly') || name.includes('usage')) anomalyAlerts++;
        if (name.includes('geo')) geoAnomalyAlerts++;
        if (name.includes('chargeback')) chargebackPredictions++;
      }
    }

    const totalChecks = this.scores.length;
    const avgRisk = totalChecks > 0 ? Math.round(totalRisk / totalChecks) : 0;

    const totalFeedback = this.falsePositiveFeedback.length;
    const falsePositiveRate =
      flagged + blocked > 0 ? Math.round((totalFeedback / (flagged + blocked)) * 100) : 0;
    const modelConfidence = Math.max(0, 100 - falsePositiveRate * 2);

    const stats = this.investigations.getStats();

    return {
      totalChecks,
      approved,
      flagged,
      blocked,
      avgRisk,
      velocityAlerts,
      anomalyAlerts,
      geoAnomalyAlerts,
      chargebackPredictions,
      falsePositiveRate,
      modelConfidence,
      manualReviewsClosed: stats.reviewed + stats.dismissed,
    };
  }

  private _buildReviewQueue(): ReviewQueueItem[] {
    const { cases } = this.investigations.getCases({
      status: 'pending',
      limit: 50,
    });
    const escalated = this.investigations.getCases({ status: 'escalated', limit: 50 }).cases;
    const allOpen = [...cases, ...escalated].sort(
      (a, b) => b.riskScore - a.riskScore
    );

    return allOpen.map((c: FraudCase) => ({
      caseId: c.caseId,
      subscriptionId: c.subscriptionId,
      subscriberId: c.subscriberId,
      merchantId: c.merchantId,
      merchantName: c.merchantName ?? '',
      subscriptionName: c.subscriptionName ?? '',
      riskScore: c.riskScore,
      action: c.action,
      reason: c.reason,
      outcome: c.outcome,
      evidence: (c.evidence ?? []) as Array<{ evidenceId: string; label: string; value: string }>,
    }));
  }

  private _buildSubscriptionList(): SubscriptionRiskItem[] {
    return this.scores.map((tracked) => ({
      id: tracked.subscriptionId,
      subscriptionId: tracked.subscriptionId,
      subscriptionName: tracked.subscriptionName,
      subscriberId: tracked.subscriberId,
      merchantId: tracked.merchantId,
      merchantName: tracked.merchantName,
      amount: tracked.amount,
      currency: tracked.currency,
      riskScore: tracked.score.totalScore,
      action: tracked.score.action,
      signals: tracked.score.scoredRules
        .filter((r) => r.triggered)
        .map((r) => ({
          kind: r.ruleName,
          score: r.rawScore,
          observedAt: tracked.assessedAt,
        })),
    }));
  }

  private _buildAssessmentFeed(): AssessmentFeedItem[] {
    return [...this.scores]
      .sort((a, b) => b.assessedAt - a.assessedAt)
      .slice(0, 20)
      .map((tracked) => ({
        subscriptionId: tracked.subscriptionId,
        merchantName: tracked.merchantName,
        reason: tracked.score.reason,
        action: tracked.score.action,
        assessedAt: tracked.assessedAt,
        signals: tracked.score.scoredRules
          .filter((r) => r.triggered)
          .map((r) => ({
            kind: r.ruleName,
            score: r.rawScore,
            observedAt: tracked.assessedAt,
          })),
      }));
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const fraudDashboardService = new FraudDashboardService();
