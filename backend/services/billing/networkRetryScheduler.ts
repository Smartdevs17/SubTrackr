/**
 * Network-aware intelligent payment retry scheduler (Issue #2198).
 *
 * Combines card network and decline-code priors with an incrementally learned
 * success model to pick retry windows for failed subscription charges. The
 * model is dependency-free and deterministic, so schedules can be reproduced
 * from the same inputs in tests, workers and the admin console.
 */

const HOUR_MS = 3_600_000;

export type CardNetwork = 'visa' | 'mastercard' | 'amex' | 'discover' | 'jcb' | 'unknown';

export type NetworkDeclineCode =
  | 'insufficient_funds'
  | 'expired_card'
  | 'do_not_honor'
  | 'authentication_required'
  | 'card_lost_stolen'
  | 'processing_error'
  | 'issuer_unavailable'
  | 'generic_decline';

export type RetryOutreachChannel = 'email' | 'push' | 'sms';

export type DunningFailureType =
  | 'insufficient_funds'
  | 'card_declined'
  | 'expired_card'
  | 'network_error'
  | 'processing_error'
  | 'auth_required'
  | 'unknown';

interface NetworkProfile {
  /** Prior probability boost (or penalty) for this network. */
  prior: number;
  /** Hour of day (UTC) with the highest observed authorisation rate. */
  preferredHour: number;
  backoffMultiplier: number;
  maxAttempts: number;
}

interface DeclineProfile {
  baseDelayHours: number;
  backoffMultiplier: number;
  maxDelayHours: number;
  retryable: boolean;
  channel: RetryOutreachChannel;
  /** Fit along the logit, positive values mean the code recovers quickly. */
  recoveryBias: number;
  reason: string;
}

interface LearningSample {
  trials: number;
  successes: number;
}

export interface NetworkRetryInput {
  subscriptionId: string;
  cardNetwork: CardNetwork;
  declineCode: NetworkDeclineCode;
  /** Number of previous failed attempts for this charge (0 for the first). */
  attempt: number;
  amount: number;
  /** Historical success rate for this subscriber, when known. */
  previousSuccessRate?: number;
  maxAttempts?: number;
  now?: Date;
}

export interface RetryWindowCandidate {
  scheduledAt: Date;
  delayHours: number;
  cardNetwork: CardNetwork;
  declineCode: NetworkDeclineCode;
  expectedSuccessProbability: number;
  score: number;
  outreachChannel: RetryOutreachChannel;
  reason: string;
}

export interface NetworkRetryPlan {
  subscriptionId: string;
  cardNetwork: CardNetwork;
  declineCode: NetworkDeclineCode;
  modelVersion: string;
  retryable: boolean;
  terminalReason?: string;
  candidates: RetryWindowCandidate[];
}

export interface RetryOutcomeInput {
  subscriptionId: string;
  cardNetwork: CardNetwork;
  declineCode: NetworkDeclineCode;
  delayHours: number;
  succeeded: boolean;
  occurredAt?: Date;
}

export interface NetworkInsights {
  cardNetwork: CardNetwork;
  attempts: number;
  successes: number;
  successRate: number;
  bestHourUtc: number | null;
  averageSuccessfulDelayHours: number;
}

const NETWORK_PROFILES: Record<CardNetwork, NetworkProfile> = {
  visa: { prior: 0.22, preferredHour: 10, backoffMultiplier: 1.9, maxAttempts: 5 },
  mastercard: { prior: 0.16, preferredHour: 11, backoffMultiplier: 2.0, maxAttempts: 5 },
  amex: { prior: 0.05, preferredHour: 9, backoffMultiplier: 1.7, maxAttempts: 4 },
  discover: { prior: 0.08, preferredHour: 12, backoffMultiplier: 1.8, maxAttempts: 4 },
  jcb: { prior: -0.1, preferredHour: 8, backoffMultiplier: 2.2, maxAttempts: 3 },
  unknown: { prior: -0.2, preferredHour: 12, backoffMultiplier: 2.0, maxAttempts: 3 },
};

const DECLINE_PROFILES: Record<NetworkDeclineCode, DeclineProfile> = {
  insufficient_funds: {
    baseDelayHours: 48,
    backoffMultiplier: 1.5,
    maxDelayHours: 168,
    retryable: true,
    channel: 'email',
    recoveryBias: -0.1,
    reason: 'Payroll and top-up cycles usually restore funds within two days',
  },
  expired_card: {
    baseDelayHours: 1,
    backoffMultiplier: 1.2,
    maxDelayHours: 24,
    retryable: true,
    channel: 'push',
    recoveryBias: 0.35,
    reason: 'Card updater or a shopper card refresh makes a short retry effective',
  },
  do_not_honor: {
    baseDelayHours: 24,
    backoffMultiplier: 2,
    maxDelayHours: 120,
    retryable: true,
    channel: 'email',
    recoveryBias: -0.25,
    reason: 'Issuer-level decline; spread retries across business hours',
  },
  authentication_required: {
    baseDelayHours: 2,
    backoffMultiplier: 1,
    maxDelayHours: 12,
    retryable: true,
    channel: 'push',
    recoveryBias: 0.5,
    reason: 'Send a 3DS deep link before retrying the authorisation',
  },
  card_lost_stolen: {
    baseDelayHours: 0,
    backoffMultiplier: 1,
    maxDelayHours: 0,
    retryable: false,
    channel: 'push',
    recoveryBias: -3,
    reason: 'Card is blocked; require a new payment method instead of retrying',
  },
  processing_error: {
    baseDelayHours: 0.5,
    backoffMultiplier: 1.5,
    maxDelayHours: 12,
    retryable: true,
    channel: 'email',
    recoveryBias: 0.2,
    reason: 'Processor faults are typically transient',
  },
  issuer_unavailable: {
    baseDelayHours: 1,
    backoffMultiplier: 1.7,
    maxDelayHours: 24,
    retryable: true,
    channel: 'email',
    recoveryBias: 0.15,
    reason: 'Issuer outage; retry within a short window',
  },
  generic_decline: {
    baseDelayHours: 24,
    backoffMultiplier: 2,
    maxDelayHours: 96,
    retryable: true,
    channel: 'email',
    recoveryBias: -0.15,
    reason: 'Generic decline; use the learned network prior to rank windows',
  },
};

const CARD_NETWORKS: CardNetwork[] = [
  'visa',
  'mastercard',
  'amex',
  'discover',
  'jcb',
  'unknown',
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-clamp(value, -30, 30)));
}

function hash(input: string): number {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function deterministicJitter(key: string): number {
  return (hash(key) / 0xffffffff - 0.5) * 0.08;
}

function emptySample(): LearningSample {
  return { trials: 0, successes: 0 };
}

function sampleRate(sample: LearningSample | undefined): number | null {
  if (!sample || sample.trials < 5) return null;
  return sample.successes / sample.trials;
}

/** Normalise a PAN, BIN or gateway network label into a canonical network. */
export function normalizeCardNetwork(value: string): CardNetwork {
  const digits = value.replace(/\D/g, '');
  const label = value.trim().toLowerCase();

  if (label.includes('visa')) return 'visa';
  if (label.includes('master')) return 'mastercard';
  if (label.includes('american') || label.includes('amex')) return 'amex';
  if (label.includes('discover')) return 'discover';
  if (label.includes('jcb')) return 'jcb';

  if (digits.length === 0) return 'unknown';
  if (digits.startsWith('4')) return 'visa';
  if (digits.startsWith('34') || digits.startsWith('37')) return 'amex';
  if (digits.startsWith('35')) return 'jcb';
  if (/^(6011|65|64[4-9])/.test(digits)) return 'discover';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'mastercard';
  return 'unknown';
}

export function isRetryableDecline(code: NetworkDeclineCode): boolean {
  return DECLINE_PROFILES[code].retryable;
}

/** Map a decline code onto the existing dunning failure taxonomy. */
export function toDunningFailureType(code: NetworkDeclineCode): DunningFailureType {
  switch (code) {
    case 'insufficient_funds':
      return 'insufficient_funds';
    case 'expired_card':
      return 'expired_card';
    case 'authentication_required':
      return 'auth_required';
    case 'processing_error':
    case 'issuer_unavailable':
      return 'network_error';
    case 'card_lost_stolen':
    case 'do_not_honor':
      return 'card_declined';
    default:
      return 'unknown';
  }
}

export class NetworkRetryScheduler {
  static readonly MODEL_VERSION = 'network-retry-2026.11';

  private readonly networkSamples = new Map<CardNetwork, LearningSample>();
  private readonly declineSamples = new Map<NetworkDeclineCode, LearningSample>();
  private readonly hourSamples = new Map<string, LearningSample>();
  private readonly subscriberSamples = new Map<string, LearningSample>();
  private readonly successfulDelays = new Map<CardNetwork, { total: number; count: number }>();

  /** Rank candidate retry windows for a failed charge. */
  planRetry(input: NetworkRetryInput): NetworkRetryPlan {
    const profile = NETWORK_PROFILES[input.cardNetwork];
    const decline = DECLINE_PROFILES[input.declineCode];
    const attempt = Math.max(0, Math.floor(input.attempt));
    const maxAttempts = clamp(input.maxAttempts ?? profile.maxAttempts, 1, 10);

    if (!decline.retryable) {
      return {
        subscriptionId: input.subscriptionId,
        cardNetwork: input.cardNetwork,
        declineCode: input.declineCode,
        modelVersion: NetworkRetryScheduler.MODEL_VERSION,
        retryable: false,
        terminalReason: decline.reason,
        candidates: [],
      };
    }

    if (attempt >= maxAttempts) {
      return {
        subscriptionId: input.subscriptionId,
        cardNetwork: input.cardNetwork,
        declineCode: input.declineCode,
        modelVersion: NetworkRetryScheduler.MODEL_VERSION,
        retryable: false,
        terminalReason: `Retry cap of ${maxAttempts} attempts reached`,
        candidates: [],
      };
    }

    const now = (input.now ?? new Date()).getTime();
    const nextAttempt = attempt + 1;
    const baseDelay =
      decline.baseDelayHours * Math.pow(profile.backoffMultiplier, attempt) * decline.backoffMultiplier;
    const cappedDelay = clamp(baseDelay, decline.baseDelayHours, decline.maxDelayHours);

    const candidateDelays = [
      cappedDelay,
      Math.min(decline.maxDelayHours, cappedDelay * 1.5),
      Math.min(decline.maxDelayHours, cappedDelay * 2.5),
      Math.min(decline.maxDelayHours, cappedDelay + 24),
    ].map((delay) => this.shiftToPreferredHour(delay, profile.preferredHour, now));

    const candidates = Array.from(new Set(candidateDelays))
      .map((delayHours) =>
        this.buildCandidate(input, delayHours, nextAttempt, profile, decline, now)
      )
      .sort((left, right) => right.score - left.score || left.delayHours - right.delayHours);

    return {
      subscriptionId: input.subscriptionId,
      cardNetwork: input.cardNetwork,
      declineCode: input.declineCode,
      modelVersion: NetworkRetryScheduler.MODEL_VERSION,
      retryable: true,
      candidates,
    };
  }

  /** Convenience helper returning only the highest-ranked retry window. */
  nextRetry(input: NetworkRetryInput): RetryWindowCandidate | null {
    return this.planRetry(input).candidates[0] ?? null;
  }

  /** Feed a realised retry outcome back into the online learning model. */
  recordOutcome(outcome: RetryOutcomeInput): void {
    const success = outcome.succeeded ? 1 : 0;
    this.addSample(this.networkSamples, outcome.cardNetwork, success);
    this.addSample(this.declineSamples, outcome.declineCode, success);
    this.addSample(this.subscriberSamples, outcome.subscriptionId, success);
    const hour = (outcome.occurredAt ?? new Date()).getUTCHours();
    this.addSample(this.hourSamples, `${outcome.cardNetwork}:${hour}`, success);

    if (success) {
      const delays = this.successfulDelays.get(outcome.cardNetwork) ?? { total: 0, count: 0 };
      delays.total += Math.max(0, outcome.delayHours);
      delays.count += 1;
      this.successfulDelays.set(outcome.cardNetwork, delays);
    }
  }

  getNetworkInsights(cardNetwork: CardNetwork): NetworkInsights {
    const sample = this.networkSamples.get(cardNetwork) ?? emptySample();
    const bestHour = this.findBestHour(cardNetwork);
    const delays = this.successfulDelays.get(cardNetwork);

    return {
      cardNetwork,
      attempts: sample.trials,
      successes: sample.successes,
      successRate: sample.trials === 0 ? 0 : sample.successes / sample.trials,
      bestHourUtc: bestHour,
      averageSuccessfulDelayHours:
        delays && delays.count > 0 ? delays.total / delays.count : 0,
    };
  }

  /** All known networks, including networks without observations. */
  listNetworks(): CardNetwork[] {
    return [...CARD_NETWORKS];
  }

  reset(): void {
    this.networkSamples.clear();
    this.declineSamples.clear();
    this.hourSamples.clear();
    this.subscriberSamples.clear();
  }

  private buildCandidate(
    input: NetworkRetryInput,
    delayHours: number,
    attempt: number,
    network: NetworkProfile,
    decline: DeclineProfile,
    now: number
  ): RetryWindowCandidate {
    const target = new Date(now + delayHours * HOUR_MS);
    const probability = this.successProbability(input, delayHours, attempt, network, decline);
    const delayPenalty = Math.log1p(delayHours) / 12;
    const jitter = deterministicJitter(
      `${input.subscriptionId}:${input.cardNetwork}:${input.declineCode}:${attempt}:${delayHours}`
    );
    const score = probability - delayPenalty + jitter;

    return {
      scheduledAt: target,
      delayHours,
      cardNetwork: input.cardNetwork,
      declineCode: input.declineCode,
      expectedSuccessProbability: Number(probability.toFixed(4)),
      score: Number(score.toFixed(4)),
      outreachChannel: decline.channel,
      reason: decline.reason,
    };
  }

  private successProbability(
    input: NetworkRetryInput,
    delayHours: number,
    attempt: number,
    network: NetworkProfile,
    decline: DeclineProfile
  ): number {
    const learnedNetwork = sampleRate(this.networkSamples.get(input.cardNetwork));
    const learnedDecline = sampleRate(this.declineSamples.get(input.declineCode));
    const learnedSubscriber = sampleRate(this.subscriberSamples.get(input.subscriptionId));
    const historical = input.previousSuccessRate;
    const scheduledHour = new Date((input.now ?? new Date()).getTime() + delayHours * HOUR_MS).getUTCHours();
    const hourSample = sampleRate(this.hourSamples.get(`${input.cardNetwork}:${scheduledHour}`));

    const hourPrior = scheduledHour === network.preferredHour ? 0.28 : -0.12;
    const logit =
      -1.1 +
      network.prior +
      decline.recoveryBias +
      hourPrior +
      (historical === undefined ? 0 : (historical - 0.5) * 1.6) +
      (learnedNetwork === null ? 0 : (learnedNetwork - 0.5) * 1.2) +
      (learnedDecline === null ? 0 : (learnedDecline - 0.5) * 0.8) +
      (learnedSubscriber === null ? 0 : (learnedSubscriber - 0.5) * 1.4) +
      (hourSample === null ? 0 : (hourSample - 0.5) * 0.6) -
      (attempt - 1) * 0.18 -
      Math.max(0, input.amount - 500) / 5000;

    return clamp(sigmoid(logit), 0.01, 0.99);
  }

  private shiftToPreferredHour(delayHours: number, preferredHour: number, now: number): number {
    const target = new Date(now + delayHours * HOUR_MS).getUTCHours();
    const distance = (preferredHour - target + 24) % 24;
    if (distance === 0 || distance > 6) return Number(delayHours.toFixed(2));
    return Number((delayHours + distance).toFixed(2));
  }

  private addSample<K extends string>(map: Map<K, LearningSample>, key: K, success: number): void {
    const sample = map.get(key) ?? emptySample();
    sample.trials += 1;
    sample.successes += success;
    map.set(key, sample);
  }

  private findBestHour(cardNetwork: CardNetwork): number | null {
    let bestHour: number | null = null;
    let bestRate = 0;
    for (const [key, sample] of this.hourSamples) {
      if (!key.startsWith(`${cardNetwork}:`) || sample.trials < 3) continue;
      const rate = sample.successes / sample.trials;
      if (rate > bestRate) {
        bestRate = rate;
        bestHour = Number(key.split(':')[1]);
      }
    }
    return bestHour;
  }
}

export const networkRetryScheduler = new NetworkRetryScheduler();
