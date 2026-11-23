import {
  NetworkRetryScheduler,
  isRetryableDecline,
  normalizeCardNetwork,
  toDunningFailureType,
  type NetworkRetryInput,
} from '../networkRetryScheduler';

const NOW = new Date('2026-11-23T06:00:00.000Z');

const input = (overrides: Partial<NetworkRetryInput> = {}): NetworkRetryInput => ({
  subscriptionId: 'sub_123',
  cardNetwork: 'visa',
  declineCode: 'insufficient_funds',
  attempt: 0,
  amount: 29,
  now: NOW,
  ...overrides,
});

describe('normalizeCardNetwork', () => {
  it('normalises gateway labels', () => {
    expect(normalizeCardNetwork('Visa')).toBe('visa');
    expect(normalizeCardNetwork('MASTERCARD')).toBe('mastercard');
    expect(normalizeCardNetwork('American Express')).toBe('amex');
    expect(normalizeCardNetwork('discover')).toBe('discover');
    expect(normalizeCardNetwork('JCB')).toBe('jcb');
    expect(normalizeCardNetwork('')).toBe('unknown');
  });

  it('normalises BIN and PAN prefixes', () => {
    expect(normalizeCardNetwork('4242424242424242')).toBe('visa');
    expect(normalizeCardNetwork('5555555555554444')).toBe('mastercard');
    expect(normalizeCardNetwork('2223003122003222')).toBe('mastercard');
    expect(normalizeCardNetwork('378282246310005')).toBe('amex');
    expect(normalizeCardNetwork('6011111111111117')).toBe('discover');
    expect(normalizeCardNetwork('3530111333300000')).toBe('jcb');
    expect(normalizeCardNetwork('9999999999999999')).toBe('unknown');
  });
});

describe('decline-code helpers', () => {
  it('flags terminal declines as non-retryable', () => {
    expect(isRetryableDecline('card_lost_stolen')).toBe(false);
    expect(isRetryableDecline('insufficient_funds')).toBe(true);
  });

  it('maps decline codes onto the dunning failure taxonomy', () => {
    expect(toDunningFailureType('expired_card')).toBe('expired_card');
    expect(toDunningFailureType('authentication_required')).toBe('auth_required');
    expect(toDunningFailureType('issuer_unavailable')).toBe('network_error');
    expect(toDunningFailureType('generic_decline')).toBe('unknown');
  });
});

describe('NetworkRetryScheduler', () => {
  let scheduler: NetworkRetryScheduler;

  beforeEach(() => {
    scheduler = new NetworkRetryScheduler();
  });

  it('returns no retry window for a lost or stolen card', () => {
    const plan = scheduler.planRetry(input({ declineCode: 'card_lost_stolen' }));
    expect(plan.retryable).toBe(false);
    expect(plan.candidates).toHaveLength(0);
    expect(plan.terminalReason).toContain('new payment method');
    expect(scheduler.nextRetry(input({ declineCode: 'card_lost_stolen' }))).toBeNull();
  });

  it('honours the retry cap', () => {
    const plan = scheduler.planRetry(input({ attempt: 5, maxAttempts: 5 }));
    expect(plan.retryable).toBe(false);
    expect(plan.terminalReason).toContain('Retry cap');
  });

  it('produces deterministic, score-ranked candidates', () => {
    const first = scheduler.planRetry(input());
    const second = scheduler.planRetry(input());
    expect(first).toEqual(second);
    expect(first.candidates.length).toBeGreaterThan(1);
    const scores = first.candidates.map((candidate) => candidate.score);
    expect(scores).toEqual([...scores].sort((left, right) => right - left));
    expect(first.candidates[0].outreachChannel).toBe('email');
    expect(first.candidates[0].scheduledAt.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('uses card-specific backoff for expired cards', () => {
    const visa = scheduler.nextRetry(input({ declineCode: 'expired_card' }));
    const amex = scheduler.nextRetry(
      input({ declineCode: 'expired_card', cardNetwork: 'amex' })
    );
    expect(visa).not.toBeNull();
    expect(amex).not.toBeNull();
    expect(visa!.delayHours).toBeLessThan(24);
    expect(amex!.delayHours).toBeLessThanOrEqual(visa!.delayHours);
  });

  it('is reproducible across scheduler instances', () => {
    const other = new NetworkRetryScheduler();
    expect(other.planRetry(input())).toEqual(scheduler.planRetry(input()));
  });

  it('learns from successful outcomes and exposes network insights', () => {
    const before = scheduler.nextRetry(input({ declineCode: 'generic_decline' }))!;
    for (let index = 0; index < 6; index += 1) {
      scheduler.recordOutcome({
        subscriptionId: 'sub_123',
        cardNetwork: 'visa',
        declineCode: 'generic_decline',
        delayHours: before.delayHours,
        succeeded: true,
        occurredAt: before.scheduledAt,
      });
    }
    const after = scheduler.nextRetry(input({ declineCode: 'generic_decline' }))!;
    expect(after.expectedSuccessProbability).toBeGreaterThan(
      before.expectedSuccessProbability
    );

    const insights = scheduler.getNetworkInsights('visa');
    expect(insights.attempts).toBe(6);
    expect(insights.successes).toBe(6);
    expect(insights.successRate).toBe(1);
    expect(insights.averageSuccessfulDelayHours).toBeCloseTo(before.delayHours, 2);
    expect(insights.bestHourUtc).toBe(before.scheduledAt.getUTCHours());
  });

  it('does not report insights until there is enough evidence', () => {
    scheduler.recordOutcome({
      subscriptionId: 'sub_123',
      cardNetwork: 'mastercard',
      declineCode: 'processing_error',
      delayHours: 2,
      succeeded: false,
    });
    expect(scheduler.getNetworkInsights('mastercard').bestHourUtc).toBeNull();
    expect(scheduler.getNetworkInsights('jcb').successRate).toBe(0);
  });

  it('resets learned state', () => {
    scheduler.recordOutcome({
      subscriptionId: 'sub_123',
      cardNetwork: 'visa',
      declineCode: 'processing_error',
      delayHours: 1,
      succeeded: true,
    });
    scheduler.reset();
    expect(scheduler.getNetworkInsights('visa').attempts).toBe(0);
    expect(scheduler.listNetworks()).toContain('discover');
  });
});
