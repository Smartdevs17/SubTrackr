import { describe, it, expect } from 'vitest';
import { RuleEngine, evaluateCondition } from '../rules/engine.js';
import { RuleSetSchema, type RuleInput } from '../rules/schema.js';
import type { Notification } from '../types/notification.js';

const base: Notification = {
  id: 'n-1',
  channel: 'email',
  template: 'payment_failed',
  recipient: 'user@example.com',
  priority: 'normal',
  metadata: { event: 'billing.payment_failed', tier: 'premium', attempts: 3 },
};

describe('evaluateCondition', () => {
  it('supports eq, in, exists and matches on nested paths', () => {
    expect(evaluateCondition({ field: 'metadata.tier', eq: 'premium' }, base)).toBe(true);
    expect(evaluateCondition({ field: 'metadata.attempts', eq: '3' }, base)).toBe(false);
    expect(evaluateCondition({ field: 'channel', in: ['sms', 'email'] }, base)).toBe(true);
    expect(evaluateCondition({ field: 'metadata.missing', exists: false }, base)).toBe(true);
    expect(evaluateCondition({ field: 'variables.name', exists: true }, base)).toBe(false);
    expect(evaluateCondition({ field: 'metadata.event', matches: '^billing\\.' }, base)).toBe(true);
    expect(evaluateCondition({ field: 'metadata.attempts', matches: '3' }, base)).toBe(false);
  });

  it('combines conditions with all, any and not', () => {
    const premium = { field: 'metadata.tier', eq: 'premium' } as const;
    const sms = { field: 'channel', eq: 'sms' } as const;
    expect(evaluateCondition({ all: [premium, sms] }, base)).toBe(false);
    expect(evaluateCondition({ any: [premium, sms] }, base)).toBe(true);
    expect(evaluateCondition({ not: sms }, base)).toBe(true);
  });
});

describe('RuleEngine', () => {
  it('delivers on the original channel when no rule matches', () => {
    const decision = new RuleEngine().evaluate(base);
    expect(decision.deliveries).toEqual([base]);
    expect(decision.matchedRules).toEqual([]);
  });

  it('fans out, deduplicates channels and overrides priority', () => {
    const engine = new RuleEngine([
      {
        id: 'premium-payment-failure',
        when: { all: [{ field: 'template', eq: 'payment_failed' }, { field: 'metadata.tier', eq: 'premium' }] },
        then: [
          { type: 'route', channels: ['email', 'push', 'email'] },
          { type: 'setPriority', priority: 'high' },
        ],
      },
    ]);
    const decision = engine.evaluate(base);
    expect(decision.deliveries.map((d) => [d.channel, d.priority])).toEqual([
      ['email', 'high'],
      ['push', 'high'],
    ]);
    expect(decision.matchedRules).toEqual(['premium-payment-failure']);
  });

  it('suppresses and stops evaluating further actions and rules', () => {
    const engine = new RuleEngine([
      { id: 'route-sms', priority: 0, when: { field: 'channel', eq: 'email' }, then: [{ type: 'route', channels: ['sms'] }] },
      { id: 'mute-test-users', priority: 10, when: { field: 'recipient', matches: '@example\\.com$' }, then: [{ type: 'suppress', reason: 'test recipient' }] },
    ]);
    const decision = engine.evaluate(base);
    expect(decision.deliveries).toEqual([]);
    expect(decision.suppressedBy).toEqual({ ruleId: 'mute-test-users', reason: 'test recipient' });
    expect(decision.matchedRules).toEqual(['mute-test-users']);
  });

  it('orders by priority, keeps file order on ties, honours stop and skips disabled rules', () => {
    const rules: RuleInput[] = [
      { id: 'a', when: { field: 'channel', eq: 'email' }, then: [{ type: 'route', channels: ['push'] }] },
      { id: 'b', when: { field: 'channel', eq: 'email' }, then: [{ type: 'route', channels: ['sms'] }] },
      { id: 'off', priority: 99, enabled: false, when: { field: 'channel', eq: 'email' }, then: [{ type: 'suppress', reason: 'x' }] },
    ];
    expect(new RuleEngine(rules).evaluate(base).deliveries.map((d) => d.channel)).toEqual(['sms']);
    expect(new RuleEngine(rules).evaluate(base).matchedRules).toEqual(['a', 'b']);

    const stopped = new RuleEngine([{ ...rules[0], stop: true }, rules[1]]);
    expect(stopped.evaluate(base).deliveries.map((d) => d.channel)).toEqual(['push']);
    expect(new RuleEngine(rules).size).toBe(2);
  });

  it('matches conditions against the original notification, not the rewritten one', () => {
    const engine = new RuleEngine([
      { id: 'to-sms', when: { field: 'channel', eq: 'email' }, then: [{ type: 'route', channels: ['sms'] }] },
      { id: 'sms-only', when: { field: 'channel', eq: 'sms' }, then: [{ type: 'suppress', reason: 'no' }] },
    ]);
    expect(engine.evaluate(base).deliveries.map((d) => d.channel)).toEqual(['sms']);
  });
});

describe('rule validation', () => {
  const valid = { id: 'r', when: { field: 'channel', eq: 'email' }, then: [{ type: 'suppress', reason: 'r' }] };

  it.each([
    ['unknown channel', { ...valid, then: [{ type: 'route', channels: ['fax'] }] }],
    ['unknown action', { ...valid, then: [{ type: 'explode' }] }],
    ['empty actions', { ...valid, then: [] }],
    ['bad regex', { ...valid, when: { field: 'template', matches: '(' } }],
    ['bad field path', { ...valid, when: { field: 'a..b', eq: 1 } }],
    ['ambiguous condition', { ...valid, when: { field: 'channel', eq: 'email', exists: true } }],
    ['unknown key', { ...valid, unexpected: true }],
  ])('rejects %s', (_label, rule) => {
    expect(() => new RuleEngine([rule as never])).toThrow();
  });

  it('rejects duplicate rule ids', () => {
    expect(RuleSetSchema.safeParse([valid, valid]).success).toBe(false);
  });
});
