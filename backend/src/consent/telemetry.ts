/**
 * backend/src/consent/telemetry.ts
 *
 * Observability and metrics hooks for the consent management subsystem.
 */

import { logger } from '../utils/logger';
import type { ConsentCategory, ConsentMetrics, ConsentSource } from './types';

export const noopConsentMetrics: ConsentMetrics = {
  recordGrant: () => {},
  recordWithdrawal: () => {},
  recordReconsentRequired: () => {},
  recordVerificationFailure: () => {},
};

export class StructuredConsentTelemetry implements ConsentMetrics {
  private readonly counts = {
    grants: new Map<string, number>(),
    withdrawals: new Map<string, number>(),
    reconsentRequired: 0,
    verificationFailures: 0,
  };

  recordGrant(category: ConsentCategory, source: ConsentSource): void {
    const key = `${category}:${source}`;
    this.counts.grants.set(key, (this.counts.grants.get(key) ?? 0) + 1);
    logger.info('Consent granted', { category, source });
  }

  recordWithdrawal(category: ConsentCategory, source: ConsentSource): void {
    const key = `${category}:${source}`;
    this.counts.withdrawals.set(key, (this.counts.withdrawals.get(key) ?? 0) + 1);
    logger.info('Consent withdrawn', { category, source });
  }

  recordReconsentRequired(userId: string): void {
    this.counts.reconsentRequired += 1;
    logger.info('Re-consent required due to policy change', { userId });
  }

  recordVerificationFailure(recordId: string): void {
    this.counts.verificationFailures += 1;
    logger.warn('Consent record signature verification failed', { recordId });
  }

  getSnapshot() {
    return {
      grants: Object.fromEntries(this.counts.grants),
      withdrawals: Object.fromEntries(this.counts.withdrawals),
      reconsentRequired: this.counts.reconsentRequired,
      verificationFailures: this.counts.verificationFailures,
    };
  }
}
