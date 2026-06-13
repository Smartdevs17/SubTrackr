/**
 * Retention Offer Service
 * Generates segment-based retention offers, handles A/B testing,
 * offer expiry, abuse prevention, and win-back campaign triggers.
 */

export type OfferType = 'discount' | 'pause' | 'feature_upgrade' | 'plan_change';

export interface RetentionOffer {
  id: string;
  type: OfferType;
  title: string;
  description: string;
  /** Discount percentage (0-100) for 'discount' type */
  discountPercent?: number;
  /** Number of months the discount applies */
  discountMonths?: number;
  /** Pause duration in days for 'pause' type */
  pauseDays?: number;
  /** Feature name for 'feature_upgrade' type */
  featureName?: string;
  /** Target plan id for 'plan_change' type */
  targetPlanId?: string;
  /** ISO timestamp when offer expires */
  expiresAt: string;
  /** A/B test variant identifier */
  abVariant: 'A' | 'B';
}

export interface OfferResult {
  accepted: boolean;
  offerId: string;
  acceptedAt?: string;
}

export interface CancellationRecord {
  subscriptionId: string;
  userId: string;
  reason: string;
  reasonCategory: CancellationReasonCategory;
  offersPresented: string[];
  offerAccepted: string | null;
  cancelledAt: string;
  coolOffEndsAt: string;
}

export type CancellationReasonCategory =
  | 'price'
  | 'competitor'
  | 'technical'
  | 'missing_feature'
  | 'not_using'
  | 'other';

export interface UserSegmentContext {
  userId: string;
  subscriptionId: string;
  subscriptionName: string;
  monthlyPrice: number;
  monthsActive: number;
  totalMonthlySpend: number;
  subscriptionTier: string;
}

// In-memory store for abuse prevention (in production, use Redis/DB)
const offerAcceptanceLog = new Map<string, { count: number; lastAcceptedAt: number }>();
const activeOffers = new Map<string, RetentionOffer>();
const cancellationRecords: CancellationRecord[] = [];

const COOL_OFF_DAYS = 3;
const OFFER_EXPIRY_HOURS = 24;
const MAX_OFFER_ACCEPTS_PER_YEAR = 2;

/**
 * Categorize a free-text cancellation reason into a structured category.
 */
export function categorizeCancellationReason(reason: string): CancellationReasonCategory {
  const lower = reason.toLowerCase();
  if (lower.includes('expensive') || lower.includes('price') || lower.includes('cost') || lower.includes('afford')) return 'price';
  if (lower.includes('competitor') || lower.includes('switching') || lower.includes('alternative')) return 'competitor';
  if (lower.includes('bug') || lower.includes('technical') || lower.includes('issue') || lower.includes('broken')) return 'technical';
  if (lower.includes('feature') || lower.includes('missing') || lower.includes('need')) return 'missing_feature';
  if (lower.includes('not using') || lower.includes("don't use") || lower.includes('no longer')) return 'not_using';
  return 'other';
}

/**
 * Check if a user has abused offers (accepted too many in the past year).
 */
function isOfferAbuser(userId: string): boolean {
  const log = offerAcceptanceLog.get(userId);
  if (!log) return false;
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  if (log.lastAcceptedAt < oneYearAgo) {
    offerAcceptanceLog.delete(userId);
    return false;
  }
  return log.count >= MAX_OFFER_ACCEPTS_PER_YEAR;
}

/**
 * Determine A/B variant deterministically from userId.
 */
function getAbVariant(userId: string): 'A' | 'B' {
  const sum = userId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return sum % 2 === 0 ? 'A' : 'B';
}

/**
 * Generate retention offers based on user segment context and cancellation reason.
 * Returns up to 2 offers. Returns empty array if user is an offer abuser.
 */
export function generateRetentionOffers(
  context: UserSegmentContext,
  reasonCategory: CancellationReasonCategory
): RetentionOffer[] {
  if (isOfferAbuser(context.userId)) return [];

  const expiresAt = new Date(Date.now() + OFFER_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
  const variant = getAbVariant(context.userId);
  const offers: RetentionOffer[] = [];

  // Primary offer based on reason
  switch (reasonCategory) {
    case 'price': {
      const discountPercent = context.subscriptionTier === 'premium' ? 30 : 20;
      const discountMonths = variant === 'A' ? 2 : 3;
      offers.push({
        id: `offer-${Date.now()}-discount`,
        type: 'discount',
        title: `${discountPercent}% off for ${discountMonths} months`,
        description: `Stay and save ${discountPercent}% on your next ${discountMonths} billing cycles.`,
        discountPercent,
        discountMonths,
        expiresAt,
        abVariant: variant,
      });
      break;
    }
    case 'not_using': {
      offers.push({
        id: `offer-${Date.now()}-pause`,
        type: 'pause',
        title: 'Pause your subscription',
        description: 'Take a break for up to 30 days. No charges, no data loss.',
        pauseDays: 30,
        expiresAt,
        abVariant: variant,
      });
      break;
    }
    case 'missing_feature': {
      offers.push({
        id: `offer-${Date.now()}-feature`,
        type: 'feature_upgrade',
        title: 'Unlock Premium Features Free',
        description: 'Get 30 days of premium features at no extra cost.',
        featureName: 'premium_trial',
        expiresAt,
        abVariant: variant,
      });
      break;
    }
    case 'competitor':
    case 'technical':
    case 'other':
    default: {
      const discountPercent = variant === 'A' ? 15 : 20;
      offers.push({
        id: `offer-${Date.now()}-discount`,
        type: 'discount',
        title: `${discountPercent}% loyalty discount`,
        description: `We value your loyalty. Enjoy ${discountPercent}% off for 2 months.`,
        discountPercent,
        discountMonths: 2,
        expiresAt,
        abVariant: variant,
      });
      break;
    }
  }

  // Secondary offer: plan downgrade for high-spend users
  if (context.monthlyPrice > 20 && reasonCategory === 'price') {
    offers.push({
      id: `offer-${Date.now()}-plan`,
      type: 'plan_change',
      title: 'Switch to a lighter plan',
      description: 'Keep core features at a lower price point.',
      targetPlanId: 'basic',
      expiresAt,
      abVariant: variant,
    });
  }

  // Cache active offers for expiry validation on accept
  offers.forEach((o) => activeOffers.set(o.id, o));

  return offers;
}

/**
 * Accept a retention offer. Validates expiry and abuse prevention.
 * Returns success/failure.
 */
export function acceptRetentionOffer(userId: string, offerId: string): OfferResult {
  const offer = activeOffers.get(offerId);

  if (!offer) {
    return { accepted: false, offerId, acceptedAt: undefined };
  }

  if (new Date(offer.expiresAt) < new Date()) {
    activeOffers.delete(offerId);
    return { accepted: false, offerId };
  }

  if (isOfferAbuser(userId)) {
    return { accepted: false, offerId };
  }

  // Record acceptance for abuse prevention
  const existing = offerAcceptanceLog.get(userId);
  offerAcceptanceLog.set(userId, {
    count: (existing?.count ?? 0) + 1,
    lastAcceptedAt: Date.now(),
  });

  activeOffers.delete(offerId);

  return { accepted: true, offerId, acceptedAt: new Date().toISOString() };
}

/**
 * Record a confirmed cancellation and trigger win-back campaign.
 * Returns the cancellation record with cool-off end date.
 */
export function recordCancellation(
  userId: string,
  subscriptionId: string,
  reason: string,
  offersPresented: string[],
  offerAccepted: string | null
): CancellationRecord {
  const reasonCategory = categorizeCancellationReason(reason);
  const now = new Date();
  const coolOffEndsAt = new Date(now.getTime() + COOL_OFF_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const record: CancellationRecord = {
    subscriptionId,
    userId,
    reason,
    reasonCategory,
    offersPresented,
    offerAccepted,
    cancelledAt: now.toISOString(),
    coolOffEndsAt,
  };

  cancellationRecords.push(record);

  // Trigger win-back campaign (fire-and-forget)
  triggerWinBackCampaign(record);

  return record;
}

/**
 * Trigger a win-back campaign after cancellation.
 * In production this would enqueue a job or call a campaign service.
 */
function triggerWinBackCampaign(record: CancellationRecord): void {
  // Schedule win-back email after cool-off period
  const delayMs = new Date(record.coolOffEndsAt).getTime() - Date.now();
  setTimeout(() => {
    // In production: call campaignService.createWinBackCampaign(record)
    console.log(`[RetentionService] Win-back campaign triggered for user ${record.userId}, sub ${record.subscriptionId}`);
  }, Math.max(0, delayMs));
}

/**
 * Get all cancellation records (for analytics/admin).
 */
export function getCancellationRecords(): CancellationRecord[] {
  return [...cancellationRecords];
}
