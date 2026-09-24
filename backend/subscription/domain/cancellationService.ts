/**
 * Cancellation Service – subscription cancellation flow with retention hooks.
 *
 * Supports immediate and end-of-period cancellation, retention offers
 * (discounts, plan downgrades, pause suggestions), feedback collection,
 * and cancellation analytics.
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1119
 */

export type CancellationMode = 'immediate' | 'end_of_period';

export type CancellationReason =
  | 'too_expensive'
  | 'not_using'
  | 'missing_features'
  | 'found_alternative'
  | 'poor_experience'
  | 'technical_issues'
  | 'other';

export type RetentionOfferType =
  | 'discount'
  | 'plan_downgrade'
  | 'pause'
  | 'extended_trial'
  | 'feature_unlock';

export type RetentionOfferStatus = 'offered' | 'accepted' | 'declined' | 'expired';

export type CancellationStatus =
  | 'pending'      // cancellation requested, waiting for period end
  | 'active'       // cancellation effective
  | 'reverted'     // cancellation was reverted (offer accepted)
  | 'expired';     // retention offer expired, cancellation proceeded

export interface RetentionOffer {
  id: string;
  subscriptionId: string;
  type: RetentionOfferType;
  /** Discount percentage for 'discount' type (e.g. 20 = 20% off) */
  discountPercent?: number;
  /** Target plan ID for 'plan_downgrade' type */
  targetPlanId?: string;
  /** Pause duration in days for 'pause' type */
  pauseDays?: number;
  /** Trial extension days for 'extended_trial' type */
  trialExtensionDays?: number;
  /** Feature to unlock for 'feature_unlock' type */
  featureId?: string;
  description: string;
  status: RetentionOfferStatus;
  expiresAt: number;
  createdAt: number;
  acceptedAt?: number;
  declinedAt?: number;
}

export interface CancellationFeedback {
  id: string;
  subscriptionId: string;
  reason: CancellationReason;
  comment?: string;
  rating?: number; // 1-5
  createdAt: number;
}

export interface CancellationRecord {
  id: string;
  subscriptionId: string;
  userId: string;
  mode: CancellationMode;
  status: CancellationStatus;
  reason?: CancellationReason;
  requestedAt: number;
  effectiveAt: number;
  revertedAt?: number;
  retentionOfferId?: string;
  feedbackId?: string;
  createdAt: number;
}

export interface CancellationAnalytics {
  totalCancellations: number;
  activeCancellations: number;
  pendingCancellations: number;
  revertedCancellations: number;
  retentionRate: number;
  offerAcceptanceRate: number;
  byReason: Record<string, number>;
  byMode: Record<string, number>;
  averageTimeToCancel: number; // days from creation to cancellation request
}

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${ts}_${rand}`;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const RETENTION_RULES: Array<{
  reasons: CancellationReason[];
  type: RetentionOfferType;
  discountPercent?: number;
  description: string;
}> = [
  {
    reasons: ['too_expensive'],
    type: 'discount',
    discountPercent: 20,
    description: 'We would love to keep you! Here is 20% off your next 3 months.',
  },
  {
    reasons: ['not_using'],
    type: 'pause',
    description: 'Going on a break? Pause your subscription instead of cancelling.',
  },
  {
    reasons: ['missing_features'],
    type: 'feature_unlock',
    description: 'Tell us what is missing — we may unlock premium features for you.',
  },
  {
    reasons: ['poor_experience', 'technical_issues'],
    type: 'discount',
    discountPercent: 50,
    description: 'We are sorry for the inconvenience. Here is 50% off your next month.',
  },
  {
    reasons: ['found_alternative'],
    type: 'plan_downgrade',
    description: 'Consider downgrading to a lower tier before leaving.',
  },
];

export class CancellationService {
  private cancellations = new Map<string, CancellationRecord>();
  private offers = new Map<string, RetentionOffer>();
  private feedback = new Map<string, CancellationFeedback>();
  private subscriptionCreatedAt = new Map<string, number>();

  /** Default retention offer expiry: 7 days */
  private offerExpiryDays = 7;

  /**
   * Initiate a cancellation request.
   * If retention offers are applicable, one is generated and returned alongside
   * the cancellation record. The cancellation stays in `pending` status until
   * the retention offer is resolved or the effective date is reached.
   */
  initiate(params: {
    subscriptionId: string;
    userId: string;
    mode: CancellationMode;
    reason?: CancellationReason;
    nextBillingDate?: number | string;
  }): { cancellation: CancellationRecord; retentionOffer: RetentionOffer | null } {
    const now = Date.now();

    // Check for existing active/pending cancellation
    const existing = this.getActiveCancellation(params.subscriptionId);
    if (existing) {
      throw new Error(
        `Subscription ${params.subscriptionId} already has an active cancellation (${existing.id})`,
      );
    }

    const effectiveAt =
      params.mode === 'immediate'
        ? now
        : params.nextBillingDate
          ? typeof params.nextBillingDate === 'string'
            ? new Date(params.nextBillingDate).getTime()
            : params.nextBillingDate
          : now + 30 * MS_PER_DAY;

    const cancellation: CancellationRecord = {
      id: generateId('cancel'),
      subscriptionId: params.subscriptionId,
      userId: params.userId,
      mode: params.mode,
      status: params.mode === 'immediate' ? 'active' : 'pending',
      reason: params.reason,
      requestedAt: now,
      effectiveAt,
      createdAt: now,
    };

    this.cancellations.set(cancellation.id, cancellation);

    // Generate retention offer if reason provided
    let retentionOffer: RetentionOffer | null = null;
    if (params.reason) {
      retentionOffer = this.generateRetentionOffer(params.subscriptionId, params.reason);
      if (retentionOffer) {
        cancellation.retentionOfferId = retentionOffer.id;
      }
    }

    return { cancellation, retentionOffer };
  }

  /**
   * Generate a retention offer based on the cancellation reason.
   */
  private generateRetentionOffer(
    subscriptionId: string,
    reason: CancellationReason,
  ): RetentionOffer | null {
    const rule = RETENTION_RULES.find((r) => r.reasons.includes(reason));
    if (!rule) return null;

    const now = Date.now();
    const offer: RetentionOffer = {
      id: generateId('offer'),
      subscriptionId,
      type: rule.type,
      discountPercent: rule.discountPercent,
      description: rule.description,
      status: 'offered',
      expiresAt: now + this.offerExpiryDays * MS_PER_DAY,
      createdAt: now,
    };

    this.offers.set(offer.id, offer);
    return offer;
  }

  /**
   * Accept a retention offer — this reverts the pending cancellation.
   */
  acceptOffer(offerId: string): { offer: RetentionOffer; cancellation: CancellationRecord | null } {
    const offer = this.offers.get(offerId);
    if (!offer) throw new Error(`Retention offer ${offerId} not found`);
    if (offer.status !== 'offered') throw new Error(`Offer ${offerId} is already ${offer.status}`);

    offer.status = 'accepted';
    offer.acceptedAt = Date.now();

    // Revert the associated cancellation
    let cancellation: CancellationRecord | null = null;
    if (offer.subscriptionId) {
      cancellation = this.getActiveCancellation(offer.subscriptionId);
      if (cancellation) {
        cancellation.status = 'reverted';
        cancellation.revertedAt = Date.now();
      }
    }

    return { offer, cancellation };
  }

  /**
   * Decline a retention offer — cancellation proceeds.
   */
  declineOffer(offerId: string): RetentionOffer {
    const offer = this.offers.get(offerId);
    if (!offer) throw new Error(`Retention offer ${offerId} not found`);
    if (offer.status !== 'offered') throw new Error(`Offer ${offerId} is already ${offer.status}`);

    offer.status = 'declined';
    offer.declinedAt = Date.now();
    return offer;
  }

  /**
   * Submit cancellation feedback.
   */
  submitFeedback(params: {
    subscriptionId: string;
    reason: CancellationReason;
    comment?: string;
    rating?: number;
  }): CancellationFeedback {
    if (params.rating !== undefined && (params.rating < 1 || params.rating > 5)) {
      throw new Error('Rating must be between 1 and 5');
    }

    const feedback: CancellationFeedback = {
      id: generateId('feedback'),
      subscriptionId: params.subscriptionId,
      reason: params.reason,
      comment: params.comment,
      rating: params.rating,
      createdAt: Date.now(),
    };

    this.feedback.set(feedback.id, feedback);

    // Link feedback to the cancellation if one exists
    const cancellation = this.getActiveCancellation(params.subscriptionId);
    if (cancellation) {
      cancellation.feedbackId = feedback.id;
    }

    return feedback;
  }

  /**
   * Revert a pending cancellation directly (without an offer).
   */
  revert(cancellationId: string): CancellationRecord {
    const cancellation = this.cancellations.get(cancellationId);
    if (!cancellation) throw new Error(`Cancellation ${cancellationId} not found`);
    if (cancellation.status === 'reverted') throw new Error('Cancellation already reverted');
    if (cancellation.status === 'active' && cancellation.mode === 'immediate') {
      throw new Error('Cannot revert an immediate cancellation that is already active');
    }

    cancellation.status = 'reverted';
    cancellation.revertedAt = Date.now();
    return cancellation;
  }

  /**
   * Process expired retention offers — mark them expired and activate
   * pending cancellations whose effective date has passed.
   */
  processExpirations(now: number = Date.now()): {
    expiredOffers: RetentionOffer[];
    activatedCancellations: CancellationRecord[];
  } {
    const expiredOffers: RetentionOffer[] = [];
    const activatedCancellations: CancellationRecord[] = [];

    for (const offer of this.offers.values()) {
      if (offer.status === 'offered' && offer.expiresAt <= now) {
        offer.status = 'expired';
        expiredOffers.push(offer);
      }
    }

    for (const cancellation of this.cancellations.values()) {
      if (cancellation.status === 'pending' && cancellation.effectiveAt <= now) {
        cancellation.status = 'active';
        activatedCancellations.push(cancellation);
      }
    }

    return { expiredOffers, activatedCancellations };
  }

  /** Get the active or pending cancellation for a subscription. */
  getActiveCancellation(subscriptionId: string): CancellationRecord | null {
    for (const c of this.cancellations.values()) {
      if (c.subscriptionId === subscriptionId && (c.status === 'pending' || c.status === 'active')) {
        return c;
      }
    }
    return null;
  }

  /** Get a cancellation by ID. */
  getCancellation(cancellationId: string): CancellationRecord | undefined {
    return this.cancellations.get(cancellationId);
  }

  /** Get retention offer by ID. */
  getOffer(offerId: string): RetentionOffer | undefined {
    return this.offers.get(offerId);
  }

  /** List cancellations for a subscription. */
  listCancellations(subscriptionId: string): CancellationRecord[] {
    return Array.from(this.cancellations.values()).filter(
      (c) => c.subscriptionId === subscriptionId,
    );
  }

  /** List retention offers for a subscription. */
  listOffers(subscriptionId: string): RetentionOffer[] {
    return Array.from(this.offers.values()).filter((o) => o.subscriptionId === subscriptionId);
  }

  /** Get feedback for a subscription. */
  getFeedback(subscriptionId: string): CancellationFeedback[] {
    return Array.from(this.feedback.values()).filter((f) => f.subscriptionId === subscriptionId);
  }

  /** Track subscription creation time for analytics. */
  trackSubscriptionCreation(subscriptionId: string, createdAt: number): void {
    this.subscriptionCreatedAt.set(subscriptionId, createdAt);
  }

  /** Build cancellation analytics. */
  getAnalytics(): CancellationAnalytics {
    const all = Array.from(this.cancellations.values());
    const total = all.length;
    const active = all.filter((c) => c.status === 'active').length;
    const pending = all.filter((c) => c.status === 'pending').length;
    const reverted = all.filter((c) => c.status === 'reverted').length;

    const allOffers = Array.from(this.offers.values());
    const offeredOffers = allOffers.filter((o) => o.status !== 'offered' || true); // all offers ever created
    const acceptedOffers = allOffers.filter((o) => o.status === 'accepted').length;
    const offerAcceptanceRate =
      offeredOffers.length > 0 ? (acceptedOffers / offeredOffers.length) * 100 : 0;

    const retentionRate = total > 0 ? (reverted / total) * 100 : 0;

    const byReason: Record<string, number> = {};
    const byMode: Record<string, number> = {};
    let timeToCancelSum = 0;
    let timeToCancelCount = 0;

    for (const c of all) {
      if (c.reason) {
        byReason[c.reason] = (byReason[c.reason] ?? 0) + 1;
      }
      byMode[c.mode] = (byMode[c.mode] ?? 0) + 1;

      const created = this.subscriptionCreatedAt.get(c.subscriptionId);
      if (created) {
        timeToCancelSum += (c.requestedAt - created) / MS_PER_DAY;
        timeToCancelCount++;
      }
    }

    return {
      totalCancellations: total,
      activeCancellations: active,
      pendingCancellations: pending,
      revertedCancellations: reverted,
      retentionRate: Math.round(retentionRate * 100) / 100,
      offerAcceptanceRate: Math.round(offerAcceptanceRate * 100) / 100,
      byReason,
      byMode,
      averageTimeToCancel:
        timeToCancelCount > 0 ? Math.round((timeToCancelSum / timeToCancelCount) * 100) / 100 : 0,
    };
  }
}

export const cancellationService = new CancellationService();
