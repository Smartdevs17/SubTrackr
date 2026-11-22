import {
  WebhookEventFilterEngine,
  webhookFilterEngine,
  matchEventPattern,
  evaluateAttributeRule,
  getNestedProperty,
  WebhookFilterConfig,
} from '../webhookFilterEngine';

describe('WebhookEventFilterEngine', () => {
  let engine: WebhookEventFilterEngine;

  beforeEach(() => {
    engine = new WebhookEventFilterEngine();
  });

  describe('Nested Property Extraction', () => {
    it('extracts top-level and nested properties correctly', () => {
      const payload = {
        id: 'evt_123',
        type: 'subscription.created',
        data: {
          subscription: {
            id: 'sub_999',
            price: 49.99,
            currency: 'USD',
          },
          tags: ['enterprise', 'priority'],
        },
      };

      expect(getNestedProperty(payload, 'id')).toBe('evt_123');
      expect(getNestedProperty(payload, 'type')).toBe('subscription.created');
      expect(getNestedProperty(payload, 'data.subscription.price')).toBe(49.99);
      expect(getNestedProperty(payload, 'data.subscription.currency')).toBe('USD');
      expect(getNestedProperty(payload, 'data.nonexistent.field')).toBeUndefined();
      expect(getNestedProperty(null, 'id')).toBeUndefined();
    });
  });

  describe('Wildcard and Pattern Matching', () => {
    it('matches exact event types', () => {
      expect(matchEventPattern('subscription.created', 'subscription.created')).toBe(true);
      expect(matchEventPattern('subscription.created', 'payment.succeeded')).toBe(false);
    });

    it('matches wildcard prefix patterns (* and .*)', () => {
      expect(matchEventPattern('*', 'subscription.created')).toBe(true);
      expect(matchEventPattern('subscription.*', 'subscription.created')).toBe(true);
      expect(matchEventPattern('subscription.*', 'subscription.renewed')).toBe(true);
      expect(matchEventPattern('subscription.*', 'payment.succeeded')).toBe(false);
      expect(matchEventPattern('payment.*', 'payment.failed')).toBe(true);
    });

    it('matches suffix patterns (*.suffix)', () => {
      expect(matchEventPattern('*.created', 'subscription.created')).toBe(true);
      expect(matchEventPattern('*.created', 'invoice.created')).toBe(true);
      expect(matchEventPattern('*.created', 'subscription.cancelled')).toBe(false);
    });
  });

  describe('Attribute Condition Evaluations', () => {
    const payload = {
      type: 'payment.succeeded',
      data: {
        amount: 150,
        currency: 'USDC',
        customer: {
          tier: 'gold',
          region: 'NA',
          riskScore: 12,
        },
        tags: ['web3', 'recurring'],
      },
    };

    it('evaluates comparison operators (eq, neq, gt, gte, lt, lte)', () => {
      expect(evaluateAttributeRule(payload, { field: 'data.amount', operator: 'gt', value: 100 })).toBe(true);
      expect(evaluateAttributeRule(payload, { field: 'data.amount', operator: 'lt', value: 50 })).toBe(false);
      expect(evaluateAttributeRule(payload, { field: 'data.amount', operator: 'gte', value: 150 })).toBe(true);
      expect(evaluateAttributeRule(payload, { field: 'data.currency', operator: 'eq', value: 'USDC' })).toBe(true);
      expect(evaluateAttributeRule(payload, { field: 'data.currency', operator: 'neq', value: 'EUR' })).toBe(true);
    });

    it('evaluates in and nin operators', () => {
      expect(evaluateAttributeRule(payload, { field: 'data.customer.tier', operator: 'in', value: ['gold', 'platinum'] })).toBe(true);
      expect(evaluateAttributeRule(payload, { field: 'data.customer.tier', operator: 'in', value: ['silver', 'bronze'] })).toBe(false);
      expect(evaluateAttributeRule(payload, { field: 'data.customer.region', operator: 'nin', value: ['EU', 'APAC'] })).toBe(true);
    });

    it('evaluates contains, regex, and exists operators', () => {
      expect(evaluateAttributeRule(payload, { field: 'data.tags', operator: 'contains', value: 'web3' })).toBe(true);
      expect(evaluateAttributeRule(payload, { field: 'data.currency', operator: 'regex', value: '^USD?C$' })).toBe(true);
      expect(evaluateAttributeRule(payload, { field: 'data.customer.riskScore', operator: 'exists', value: true })).toBe(true);
      expect(evaluateAttributeRule(payload, { field: 'data.customer.missingField', operator: 'exists', value: false })).toBe(true);
    });
  });

  describe('Complete Webhook Event Filter Evaluation', () => {
    const sampleEvent = {
      id: 'evt_abc123',
      type: 'subscription.created',
      data: {
        plan: {
          id: 'enterprise_tier',
          price: 250,
          currency: 'USD',
        },
        subscriber: {
          id: 'user_456',
          country: 'US',
        },
      },
    };

    it('accepts event when no filter is provided or filter is disabled', () => {
      const result = engine.evaluate(sampleEvent, undefined);
      expect(result.isMatch).toBe(true);

      const disabledResult = engine.evaluate(sampleEvent, { enabled: false });
      expect(disabledResult.isMatch).toBe(true);
    });

    it('rejects events matching exclude patterns', () => {
      const filter: WebhookFilterConfig = {
        enabled: true,
        eventPatterns: ['subscription.*'],
        excludePatterns: ['subscription.created'],
      };

      const result = engine.evaluate(sampleEvent, filter);
      expect(result.isMatch).toBe(false);
      expect(result.reason).toContain('exclusion pattern');
    });

    it('evaluates AND combination rules correctly', () => {
      const filter: WebhookFilterConfig = {
        enabled: true,
        eventPatterns: ['subscription.*'],
        ruleCombination: 'AND',
        attributeRules: [
          { field: 'data.plan.price', operator: 'gte', value: 200 },
          { field: 'data.plan.currency', operator: 'eq', value: 'USD' },
        ],
      };

      const result = engine.evaluate(sampleEvent, filter);
      expect(result.isMatch).toBe(true);

      // Failing rule
      const failingFilter: WebhookFilterConfig = {
        ...filter,
        attributeRules: [
          ...filter.attributeRules!,
          { field: 'data.plan.price', operator: 'gt', value: 500 },
        ],
      };

      const failingResult = engine.evaluate(sampleEvent, failingFilter);
      expect(failingResult.isMatch).toBe(false);
      expect(failingResult.failedRule?.field).toBe('data.plan.price');
    });

    it('evaluates OR combination rules correctly', () => {
      const filter: WebhookFilterConfig = {
        enabled: true,
        eventPatterns: ['subscription.*'],
        ruleCombination: 'OR',
        attributeRules: [
          { field: 'data.plan.price', operator: 'gt', value: 1000 }, // Fails
          { field: 'data.subscriber.country', operator: 'eq', value: 'US' }, // Passes
        ],
      };

      const result = engine.evaluate(sampleEvent, filter);
      expect(result.isMatch).toBe(true);
    });

    it('projects specified fields when fieldProjections is configured', () => {
      const filter: WebhookFilterConfig = {
        enabled: true,
        eventPatterns: ['*'],
        fieldProjections: ['id', 'type', 'data.plan.price'],
      };

      const result = engine.evaluate(sampleEvent, filter);
      expect(result.isMatch).toBe(true);
      expect(result.processedPayload).toEqual({
        id: 'evt_abc123',
        type: 'subscription.created',
        'data.plan.price': 250,
      });
    });

    it('simulates filter runs for developer portal with execution telemetry', () => {
      const filter: WebhookFilterConfig = {
        enabled: true,
        eventPatterns: ['subscription.created'],
        attributeRules: [{ field: 'data.plan.price', operator: 'gt', value: 100 }],
      };

      const simulation = engine.simulate(sampleEvent, filter);
      expect(simulation.passed).toBe(true);
      expect(simulation.executionTimeMs).toBeGreaterThanOrEqual(0);
    });
  });
});
