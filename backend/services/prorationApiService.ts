/**
 * Backend Proration API & Controller Service
 *
 * Exposes proration calculation, policy configuration, and analytics
 * endpoints for backend/API consumption.
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/784
 */

import type {
  ProrationConfig,
  ProrationCalculationRequest,
  ProrationCalculationResult,
  ProrationAnalyticsSummary,
  ProrationRecord,
} from '../../src/types/prorationCalculator';
import { DEFAULT_PRORATION_CONFIG } from '../../src/types/prorationCalculator';
import {
  calculateProration,
  buildProrationAnalytics,
} from '../../src/services/prorationCalculatorService';

export class ProrationApiService {
  private config: ProrationConfig = { ...DEFAULT_PRORATION_CONFIG };
  private history: ProrationRecord[] = [];

  constructor(initialConfig?: Partial<ProrationConfig>) {
    if (initialConfig) {
      this.config = { ...this.config, ...initialConfig };
    }
  }

  /**
   * POST /api/v1/proration/calculate
   * Calculate exact prorated amount with full breakdown.
   */
  calculateProration(request: ProrationCalculationRequest): ProrationCalculationResult {
    const mergedRequest: ProrationCalculationRequest = {
      ...request,
      config: { ...this.config, ...request.config },
    };

    const result = calculateProration(mergedRequest);

    // Save record if subscription ID present
    if (request.subscriptionId) {
      this.history.push({
        id: `proration-rec-${Date.now().toString(36)}`,
        subscriptionId: request.subscriptionId,
        result,
        status: 'preview',
        createdAt: Date.now(),
      });
    }

    return result;
  }

  /**
   * POST /api/v1/proration/apply
   * Mark a proration calculation as applied to a subscription.
   */
  applyProration(calculationId: string, subscriptionId: string): ProrationRecord | null {
    const record = this.history.find((r) => r.result.id === calculationId || r.id === calculationId);
    if (!record) return null;

    record.status = 'applied';
    record.appliedAt = Date.now();
    record.subscriptionId = subscriptionId;
    return record;
  }

  /**
   * GET /api/v1/proration/config
   * Retrieve current proration configuration.
   */
  getConfig(): ProrationConfig {
    return { ...this.config };
  }

  /**
   * PUT /api/v1/proration/config
   * Update proration configuration.
   */
  updateConfig(newConfig: Partial<ProrationConfig>): ProrationConfig {
    this.config = { ...this.config, ...newConfig };
    return { ...this.config };
  }

  /**
   * GET /api/v1/proration/analytics
   * Retrieve proration analytics summary.
   */
  getAnalytics(): ProrationAnalyticsSummary {
    return buildProrationAnalytics(this.history);
  }

  /**
   * GET /api/v1/proration/history/:subscriptionId
   * Retrieve proration history for a specific subscription.
   */
  getHistoryForSubscription(subscriptionId: string): ProrationRecord[] {
    return this.history.filter((r) => r.subscriptionId === subscriptionId);
  }
}
