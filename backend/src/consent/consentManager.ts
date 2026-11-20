/**
 * backend/src/consent/consentManager.ts
 *
 * Core consent orchestrator. Enforces GDPR Art. 7 conditions:
 * - Proof of consent: signs each record with HMAC-SHA256
 * - Easy withdrawal: withdrawing non-essential categories is instant and emits events
 * - Essential processing cannot be revoked (tied to contract)
 * - Automatic re-consent prompt detection when policy version increments
 */

import { createHmac } from 'crypto';
import { InMemoryConsentRepository, type ConsentRepository } from './store';
import { noopConsentMetrics } from './telemetry';
import type {
  ConsentCategory,
  ConsentCategoryDefinition,
  ConsentDataExport,
  ConsentMetrics,
  ConsentRecord,
  ConsentSource,
  ConsentUpdatePayload,
  UserConsentState,
} from './types';

export const CURRENT_POLICY_VERSION = '2026-11-01';

export const CONSENT_DEFINITIONS: Record<ConsentCategory, ConsentCategoryDefinition> = {
  essential: {
    key: 'essential',
    title: 'Essential Operations',
    description: 'Required to maintain your account, process billing, and keep data secure.',
    legalBasis: 'contract',
    isEssential: true,
    defaultGranted: true,
  },
  analytics: {
    key: 'analytics',
    title: 'Usage Analytics',
    description: 'Helps us improve performance, detect glitches, and optimize workflows.',
    legalBasis: 'consent',
    isEssential: false,
    defaultGranted: false,
  },
  marketing: {
    key: 'marketing',
    title: 'Marketing Communications',
    description: 'Updates on new features, subscription tips, and product offers.',
    legalBasis: 'consent',
    isEssential: false,
    defaultGranted: false,
  },
  notifications: {
    key: 'notifications',
    title: 'Renewal & Price Change Alerts',
    description: 'Push notifications and SMS alerts for upcoming subscription charges.',
    legalBasis: 'consent',
    isEssential: false,
    defaultGranted: false,
  },
  data_sharing: {
    key: 'data_sharing',
    title: 'Partner Integrations',
    description: 'Syncing subscription metadata with connected partner services.',
    legalBasis: 'consent',
    isEssential: false,
    defaultGranted: false,
  },
};

export interface ConsentChangeEvent {
  userId: string;
  category: ConsentCategory;
  granted: boolean;
  source: ConsentSource;
  timestamp: string;
}

export type ConsentChangeListener = (event: ConsentChangeEvent) => void;

export interface ConsentManagerOptions {
  repository?: ConsentRepository;
  policyVersion?: string;
  secretKey?: string;
  metrics?: ConsentMetrics;
  now?: () => Date;
}

export class ConsentManager {
  private readonly repo: ConsentRepository;
  private readonly policyVersion: string;
  private readonly secretKey: string;
  private readonly metrics: ConsentMetrics;
  private readonly now: () => Date;
  private readonly listeners: Set<ConsentChangeListener> = new Set();

  constructor(options: ConsentManagerOptions = {}) {
    this.repo = options.repository ?? new InMemoryConsentRepository();
    this.policyVersion = options.policyVersion ?? CURRENT_POLICY_VERSION;
    this.secretKey = options.secretKey ?? 'subtrackr-consent-secret-salt-2026';
    this.metrics = options.metrics ?? noopConsentMetrics;
    this.now = options.now ?? (() => new Date());
  }

  onConsentChanged(listener: ConsentChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emitChange(event: ConsentChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Suppress listener error so consent recording never fails
      }
    }
  }

  /**
   * Generates a tamper-evident digital seal for an immutable consent record.
   */
  generateSignature(payload: {
    userId: string;
    category: ConsentCategory;
    status: string;
    policyVersion: string;
    source: string;
    timestamp: string;
  }): string {
    const canonical = [
      payload.userId,
      payload.category,
      payload.status,
      payload.policyVersion,
      payload.source,
      payload.timestamp,
    ].join('|');

    return createHmac('sha256', this.secretKey).update(canonical).digest('hex');
  }

  /**
   * Verifies that a consent record has not been tampered with since creation.
   */
  verifyRecordIntegrity(record: ConsentRecord): boolean {
    const expected = this.generateSignature({
      userId: record.userId,
      category: record.category,
      status: record.status,
      policyVersion: record.policyVersion,
      source: record.source,
      timestamp: record.timestamp,
    });
    const valid = expected === record.signature;
    if (!valid) {
      this.metrics.recordVerificationFailure(record.id);
    }
    return valid;
  }

  /**
   * Returns default initial consent preferences.
   * Essential is always true; all optional categories are false by default (GDPR opt-in).
   */
  getDefaultPreferences(): Record<ConsentCategory, boolean> {
    return {
      essential: true,
      analytics: false,
      marketing: false,
      notifications: false,
      data_sharing: false,
    };
  }

  /**
   * Retrieves active consent state. Initializes default if none recorded.
   */
  async getConsent(userId: string): Promise<UserConsentState> {
    const existing = await this.repo.getState(userId);
    if (existing) {
      return existing;
    }

    const defaultState: UserConsentState = {
      userId,
      policyVersion: this.policyVersion,
      preferences: this.getDefaultPreferences(),
      updatedAt: this.now().toISOString(),
      recordCount: 0,
    };

    return defaultState;
  }

  /**
   * Fast permission check to determine if a category is allowed for processing.
   */
  async isCategoryAllowed(userId: string, category: ConsentCategory): Promise<boolean> {
    if (category === 'essential') return true;
    const state = await this.getConsent(userId);
    return Boolean(state.preferences[category]);
  }

  /**
   * Checks whether the user must be re-prompted due to an outdated policy version.
   */
  async requiresReconsent(userId: string): Promise<boolean> {
    const state = await this.repo.getState(userId);
    if (!state) return true;
    const outdated = state.policyVersion !== this.policyVersion;
    if (outdated) {
      this.metrics.recordReconsentRequired(userId);
    }
    return outdated;
  }

  /**
   * Records updated consent preferences with immutable audit logging and signature.
   */
  async updateConsent(payload: ConsentUpdatePayload): Promise<UserConsentState> {
    const { userId, preferences, source, ipAddress, userAgent, metadata } = payload;
    const currentState = await this.getConsent(userId);
    const timestamp = this.now().toISOString();
    const policyVersion = payload.policyVersion ?? this.policyVersion;

    const nextPreferences: Record<ConsentCategory, boolean> = {
      ...currentState.preferences,
      essential: true, // Essential can never be revoked
    };

    const changesToRecord: Array<{ category: ConsentCategory; granted: boolean }> = [];

    for (const [key, val] of Object.entries(preferences)) {
      const category = key as ConsentCategory;
      if (!CONSENT_DEFINITIONS[category]) continue;
      if (category === 'essential') continue; // Locked

      const isGranted = Boolean(val);
      if (currentState.preferences[category] !== isGranted) {
        nextPreferences[category] = isGranted;
        changesToRecord.push({ category, granted: isGranted });
      }
    }

    // Hash IP address if provided to maintain privacy while retaining audit proof
    const ipHash = ipAddress
      ? createHmac('sha256', this.secretKey).update(ipAddress).digest('hex').substring(0, 16)
      : undefined;

    let newRecordCount = currentState.recordCount;

    for (const change of changesToRecord) {
      newRecordCount += 1;
      const status = change.granted ? 'granted' : 'withdrawn';
      const signature = this.generateSignature({
        userId,
        category: change.category,
        status,
        policyVersion,
        source,
        timestamp,
      });

      const record: ConsentRecord = {
        id: `cr_${Date.now()}_${newRecordCount}_${Math.random().toString(36).substring(2, 7)}`,
        userId,
        category: change.category,
        status,
        policyVersion,
        source,
        timestamp,
        ipHash,
        userAgent,
        metadata,
        signature,
      };

      await this.repo.saveRecord(record);

      if (change.granted) {
        this.metrics.recordGrant(change.category, source);
      } else {
        this.metrics.recordWithdrawal(change.category, source);
      }

      this.emitChange({
        userId,
        category: change.category,
        granted: change.granted,
        source,
        timestamp,
      });
    }

    const nextState: UserConsentState = {
      userId,
      policyVersion,
      preferences: nextPreferences,
      updatedAt: timestamp,
      recordCount: newRecordCount,
    };

    await this.repo.saveState(nextState);
    return nextState;
  }

  /**
   * Withdraws all optional consent categories immediately (Art. 7(3) GDPR).
   */
  async withdrawAll(userId: string, source: ConsentSource = 'mobile_app'): Promise<UserConsentState> {
    return this.updateConsent({
      userId,
      source,
      preferences: {
        analytics: false,
        marketing: false,
        notifications: false,
        data_sharing: false,
      },
    });
  }

  /**
   * Grants all optional consent categories.
   */
  async grantAll(userId: string, source: ConsentSource = 'mobile_app'): Promise<UserConsentState> {
    return this.updateConsent({
      userId,
      source,
      preferences: {
        analytics: true,
        marketing: true,
        notifications: true,
        data_sharing: true,
      },
    });
  }

  /**
   * Full data portability export of consent history under Art. 15 / 20 GDPR.
   */
  async exportConsentHistory(userId: string): Promise<ConsentDataExport> {
    const currentState = await this.getConsent(userId);
    const auditTrail = await this.repo.getHistory(userId, 1000);
    return {
      userId,
      exportedAt: this.now().toISOString(),
      currentState,
      auditTrail,
    };
  }

  /**
   * GDPR Art. 17 right to erasure support.
   */
  async forgetUser(userId: string): Promise<void> {
    await this.repo.deleteUserData(userId);
  }
}
