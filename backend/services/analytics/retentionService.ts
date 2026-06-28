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
  feedbackText?: string;
  sentiment?: SentimentLabel;
  /** True for cancellations triggered by exhausted dunning (payment failure), not a user choice. */
  isInvoluntary?: boolean;
  reactivatedAt?: string;
  /** Days between cancellation and reactivation; set only once reactivated. */
  reactivatedWithinDays?: number;
}

export type CancellationReasonCategory =
  | 'price'
  | 'competitor'
  | 'technical'
  | 'missing_feature'
  | 'not_using'
  | 'payment_failure'
  | 'other';

export type SentimentLabel = 'positive' | 'neutral' | 'negative';

export interface SentimentResult {
  label: SentimentLabel;
  /** -1 (very negative) to 1 (very positive). */
  score: number;
}

const REACTIVATION_WINDOW_DAYS = 30;
const POSITIVE_WORDS = ['love', 'great', 'good', 'easy', 'helpful', 'amazing', 'happy', 'excellent', 'works well'];
const NEGATIVE_WORDS = [
  'hate',
  'bad',
  'terrible',
  'broken',
  'bug',
  'expensive',
  'difficult',
  'frustrat',
  'awful',
  'slow',
  'confusing',
  'disappoint',
];

/**
 * Lightweight lexicon-based sentiment scorer for free-text cancellation
 * feedback. Not a trained NLP model — counts positive/negative keyword hits
 * and normalizes to a -1..1 score, which is sufficient to bucket feedback
 * into positive/neutral/negative for retention triage.
 */
export function analyzeSentiment(text: string): SentimentResult {
  const lower = text.toLowerCase();
  if (!lower.trim()) return { label: 'neutral', score: 0 };

  const positiveHits = POSITIVE_WORDS.filter((w) => lower.includes(w)).length;
  const negativeHits = NEGATIVE_WORDS.filter((w) => lower.includes(w)).length;
  const totalHits = positiveHits + negativeHits;

  if (totalHits === 0) return { label: 'neutral', score: 0 };

  const score = (positiveHits - negativeHits) / totalHits;
  const label: SentimentLabel = score > 0.2 ? 'positive' : score < -0.2 ? 'negative' : 'neutral';
  return { label, score: Math.round(score * 100) / 100 };
}

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
 * Record a confirmed (voluntary) cancellation, schedule its win-back email
 * sequence and Day-7 survey. Returns the cancellation record with cool-off
 * end date.
 */
export function recordCancellation(
  userId: string,
  subscriptionId: string,
  reason: string,
  offersPresented: string[],
  offerAccepted: string | null,
  feedbackText?: string
): CancellationRecord {
  const reasonCategory = categorizeCancellationReason(reason);
  const now = new Date();
  const coolOffEndsAt = new Date(now.getTime() + COOL_OFF_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const sentiment = feedbackText ? analyzeSentiment(feedbackText).label : undefined;

  const record: CancellationRecord = {
    subscriptionId,
    userId,
    reason,
    reasonCategory,
    offersPresented,
    offerAccepted,
    cancelledAt: now.toISOString(),
    coolOffEndsAt,
    feedbackText,
    sentiment,
  };

  cancellationRecords.push(record);
  triggerWinBackCampaign(record);
  schedulePostCancellationSurvey(record);

  return record;
}

/**
 * Records an involuntary cancellation (dunning exhausted after repeated
 * payment failures). Skips retention offers and free-text feedback — those
 * only make sense for a deliberate, in-flow user decision — but still
 * contributes to funnel analytics and win-back targeting.
 */
export function recordInvoluntaryCancellation(
  userId: string,
  subscriptionId: string,
  reason = 'Payment failure'
): CancellationRecord {
  const now = new Date();
  const coolOffEndsAt = new Date(now.getTime() + COOL_OFF_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const record: CancellationRecord = {
    subscriptionId,
    userId,
    reason,
    reasonCategory: 'payment_failure',
    offersPresented: [],
    offerAccepted: null,
    cancelledAt: now.toISOString(),
    coolOffEndsAt,
    isInvoluntary: true,
  };

  cancellationRecords.push(record);
  triggerWinBackCampaign(record);

  return record;
}

function findUnreactivatedCancellation(subscriptionId: string): CancellationRecord | undefined {
  return [...cancellationRecords].reverse().find((r) => r.subscriptionId === subscriptionId && !r.reactivatedAt);
}

/**
 * Read-only check for the "cancel and re-subscribe within 30 days" edge
 * case — does not mutate the record. Callers should confirm with
 * `markReactivation` once the re-subscription actually goes through.
 */
export function getRecentCancellation(
  subscriptionId: string,
  now: Date = new Date()
): { record: CancellationRecord; daysSinceCancellation: number } | null {
  const record = findUnreactivatedCancellation(subscriptionId);
  if (!record) return null;

  const daysSinceCancellation = Math.round(
    (now.getTime() - new Date(record.cancelledAt).getTime()) / (24 * 60 * 60 * 1000)
  );
  return { record, daysSinceCancellation };
}

/**
 * Marks the most recent un-reactivated cancellation for a subscription as
 * reactivated. Used once a re-subscription within the window is confirmed,
 * so funnel analytics can report a reactivation rate.
 */
export function markReactivation(subscriptionId: string, reactivatedAt: Date = new Date()): CancellationRecord | null {
  const record = findUnreactivatedCancellation(subscriptionId);
  if (!record) return null;

  const daysSinceCancellation = Math.round(
    (reactivatedAt.getTime() - new Date(record.cancelledAt).getTime()) / (24 * 60 * 60 * 1000)
  );

  record.reactivatedAt = reactivatedAt.toISOString();
  record.reactivatedWithinDays = daysSinceCancellation;
  return record;
}

export function isWithinReactivationWindow(daysSinceCancellation: number): boolean {
  return daysSinceCancellation <= REACTIVATION_WINDOW_DAYS;
}

// ── Win-back email sequence ──────────────────────────────────────────────────

export interface WinBackEmailStep {
  subscriptionId: string;
  dayOffset: number;
  subject: string;
  body: string;
  sendAt: string;
  sent: boolean;
}

const WIN_BACK_TEMPLATES: Record<CancellationReasonCategory, { dayOffset: number; subject: string; body: string }[]> = {
  price: [
    { dayOffset: 3, subject: "We've got a deal for you", body: 'Come back and save on your next billing cycles.' },
    { dayOffset: 14, subject: 'Still thinking it over?', body: 'Our best discount yet is waiting for you.' },
    { dayOffset: 30, subject: 'Last chance offer', body: 'This is the final reminder for your reactivation discount.' },
  ],
  competitor: [
    { dayOffset: 3, subject: "What's new since you left", body: "Here's what we've shipped recently." },
    { dayOffset: 14, subject: 'See how we compare', body: 'A quick look at why customers come back.' },
    { dayOffset: 30, subject: 'We miss you', body: 'Come back anytime — your data is still here.' },
  ],
  technical: [
    { dayOffset: 3, subject: 'We fixed it', body: 'The issue you ran into has been resolved.' },
    { dayOffset: 14, subject: 'Give us another shot', body: "We've made reliability improvements since you left." },
    { dayOffset: 30, subject: 'Your account is still here', body: 'Reactivate whenever you are ready.' },
  ],
  missing_feature: [
    { dayOffset: 3, subject: 'The feature you wanted is here', body: "We shipped what you asked for — come check it out." },
    { dayOffset: 14, subject: "New features you'll like", body: 'A roundup of recent additions.' },
    { dayOffset: 30, subject: 'Still missing something?', body: 'Tell us what would bring you back.' },
  ],
  not_using: [
    { dayOffset: 3, subject: 'Pick up where you left off', body: 'Your data is saved and ready when you are.' },
    { dayOffset: 14, subject: 'A quick tip you might have missed', body: 'Here is one feature worth trying.' },
    { dayOffset: 30, subject: 'We kept your account warm', body: 'Reactivate in one tap.' },
  ],
  payment_failure: [
    { dayOffset: 3, subject: 'Update your payment method', body: 'Reactivate instantly by updating your card.' },
    { dayOffset: 14, subject: 'Your account is paused', body: 'Update billing details to pick up where you left off.' },
    { dayOffset: 30, subject: 'Last reminder', body: 'Your account will be archived soon — update payment to keep it.' },
  ],
  other: [
    { dayOffset: 3, subject: 'We miss you', body: 'Come back and see what is new.' },
    { dayOffset: 14, subject: 'A little something for you', body: 'Here is an offer to welcome you back.' },
    { dayOffset: 30, subject: 'Final check-in', body: 'Reactivate anytime — we will keep your data ready.' },
  ],
};

const winBackSequences = new Map<string, WinBackEmailStep[]>();

/** Builds and stores the reason-specific win-back email sequence for a cancellation. */
function triggerWinBackCampaign(record: CancellationRecord): WinBackEmailStep[] {
  const templates = WIN_BACK_TEMPLATES[record.reasonCategory] ?? WIN_BACK_TEMPLATES.other;
  const cancelledAt = new Date(record.cancelledAt).getTime();

  const sequence: WinBackEmailStep[] = templates.map((t) => ({
    subscriptionId: record.subscriptionId,
    dayOffset: t.dayOffset,
    subject: t.subject,
    body: t.body,
    sendAt: new Date(cancelledAt + t.dayOffset * 24 * 60 * 60 * 1000).toISOString(),
    sent: false,
  }));

  winBackSequences.set(record.subscriptionId, sequence);
  return sequence;
}

export function getWinBackSequence(subscriptionId: string): WinBackEmailStep[] {
  return winBackSequences.get(subscriptionId) ?? [];
}

/** Returns and marks-as-sent every scheduled win-back email whose send time has passed. */
export function getDueWinBackEmails(now: Date = new Date()): WinBackEmailStep[] {
  const due: WinBackEmailStep[] = [];
  for (const sequence of winBackSequences.values()) {
    for (const step of sequence) {
      if (!step.sent && new Date(step.sendAt) <= now) {
        step.sent = true;
        due.push(step);
      }
    }
  }
  return due;
}

// ── Post-cancellation survey (Day 7) ─────────────────────────────────────────

export interface PostCancellationSurveyRequest {
  subscriptionId: string;
  userId: string;
  dueAt: string;
  status: 'pending' | 'completed';
  responseText?: string;
  sentiment?: SentimentLabel;
}

const postCancellationSurveys: PostCancellationSurveyRequest[] = [];
const SURVEY_DELAY_DAYS = 7;

function schedulePostCancellationSurvey(record: CancellationRecord): PostCancellationSurveyRequest {
  const dueAt = new Date(
    new Date(record.cancelledAt).getTime() + SURVEY_DELAY_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const survey: PostCancellationSurveyRequest = {
    subscriptionId: record.subscriptionId,
    userId: record.userId,
    dueAt,
    status: 'pending',
  };
  postCancellationSurveys.push(survey);
  return survey;
}

/** Surveys whose Day-7 due date has arrived and haven't been completed yet. */
export function getDueSurveys(now: Date = new Date()): PostCancellationSurveyRequest[] {
  return postCancellationSurveys.filter((s) => s.status === 'pending' && new Date(s.dueAt) <= now);
}

export function submitSurveyResponse(subscriptionId: string, responseText: string): PostCancellationSurveyRequest | null {
  const survey = [...postCancellationSurveys]
    .reverse()
    .find((s) => s.subscriptionId === subscriptionId && s.status === 'pending');
  if (!survey) return null;

  survey.responseText = responseText;
  survey.sentiment = analyzeSentiment(responseText).label;
  survey.status = 'completed';
  return survey;
}

// ── Funnel analytics ──────────────────────────────────────────────────────────

export interface CancellationFunnelAnalytics {
  totalCancellations: number;
  voluntaryCount: number;
  involuntaryCount: number;
  reasonDistribution: Record<CancellationReasonCategory, number>;
  /** Share of voluntary cancellations where the subscriber accepted a retention offer. */
  saveRate: number;
  /** Share of cancellations later reactivated within the 30-day window. */
  reactivationRate: number;
  sentimentDistribution: Record<SentimentLabel, number>;
}

export function getCancellationFunnelAnalytics(): CancellationFunnelAnalytics {
  const records = cancellationRecords;
  const total = records.length;
  const voluntary = records.filter((r) => !r.isInvoluntary);
  const involuntary = records.filter((r) => r.isInvoluntary);

  const reasonDistribution: Record<CancellationReasonCategory, number> = {
    price: 0,
    competitor: 0,
    technical: 0,
    missing_feature: 0,
    not_using: 0,
    payment_failure: 0,
    other: 0,
  };
  const sentimentDistribution: Record<SentimentLabel, number> = { positive: 0, neutral: 0, negative: 0 };

  for (const r of records) {
    reasonDistribution[r.reasonCategory] += 1;
    if (r.sentiment) sentimentDistribution[r.sentiment] += 1;
  }

  const saved = voluntary.filter((r) => r.offerAccepted != null).length;
  const reactivated = records.filter((r) => r.reactivatedAt != null).length;

  return {
    totalCancellations: total,
    voluntaryCount: voluntary.length,
    involuntaryCount: involuntary.length,
    reasonDistribution,
    saveRate: voluntary.length > 0 ? saved / voluntary.length : 0,
    reactivationRate: total > 0 ? reactivated / total : 0,
    sentimentDistribution,
  };
}

/**
 * Get all cancellation records (for analytics/admin).
 */
export function getCancellationRecords(): CancellationRecord[] {
  return [...cancellationRecords];
}
