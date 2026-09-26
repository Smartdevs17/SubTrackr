/**
 * Issue #776 – Unit tests for plan comparison + recommendation engine.
 */

import {
  PlanRecommendationTracker,
  comparePlans,
  recommendPlan,
  normalizePrice,
  trackRecommendationEvent,
  getComparisonAnalytics,
  createComparisonShare,
  resolveComparisonShare,
  compareAndTrack,
  recommendAndTrack,
} from '../planComparisonEngine';
import type { ComparablePlan, PreferenceProfile } from '../../types/planComparison';

const basic: ComparablePlan = {
  id: 'basic',
  name: 'Basic',
  price: 10,
  currency: 'USD',
  billingCycle: 'monthly',
  tierRank: 1,
  features: [
    { id: 'users', name: 'Users', category: 'limits', value: 3 },
    { id: 'storage', name: 'Storage', category: 'limits', value: 10 },
    { id: 'api', name: 'API', category: 'integrations', value: false },
    { id: 'sso', name: 'SSO', category: 'security', value: false },
  ],
};

const pro: ComparablePlan = {
  id: 'pro',
  name: 'Pro',
  price: 30,
  currency: 'USD',
  billingCycle: 'monthly',
  tierRank: 2,
  popular: true,
  features: [
    { id: 'users', name: 'Users', category: 'limits', value: 25 },
    { id: 'storage', name: 'Storage', category: 'limits', value: 100 },
    { id: 'api', name: 'API', category: 'integrations', value: true },
    { id: 'sso', name: 'SSO', category: 'security', value: false },
  ],
};

const enterprise: ComparablePlan = {
  id: 'enterprise',
  name: 'Enterprise',
  price: 1200,
  currency: 'USD',
  billingCycle: 'yearly',
  tierRank: 4,
  features: [
    { id: 'users', name: 'Users', category: 'limits', value: 500 },
    { id: 'storage', name: 'Storage', category: 'limits', value: 1000 },
    { id: 'api', name: 'API', category: 'integrations', value: true },
    { id: 'sso', name: 'SSO', category: 'security', value: true },
  ],
};

describe('normalizePrice', () => {
  it('normalizes yearly to monthly', () => {
    expect(normalizePrice(1200, 'yearly')).toBe(100);
  });

  it('leaves monthly unchanged', () => {
    expect(normalizePrice(30, 'monthly')).toBe(30);
  });

  it('converts weekly approximately', () => {
    expect(normalizePrice(10, 'weekly')).toBeCloseTo(10 * (52 / 12), 2);
  });
});

describe('comparePlans', () => {
  it('builds feature matrix with winners', () => {
    const result = comparePlans([basic, pro]);

    expect(result.id).toMatch(/^cmp_/);
    expect(result.plans).toHaveLength(2);
    expect(result.featureMatrix.length).toBeGreaterThan(0);

    const users = result.featureMatrix.find((d) => d.featureId === 'users');
    expect(users?.values.basic).toBe(3);
    expect(users?.values.pro).toBe(25);
    expect(users?.winnerPlanId).toBe('pro');
  });

  it('computes price diffs against cheapest and most expensive', () => {
    const result = comparePlans([basic, pro, enterprise]);
    const basicDiff = result.priceDiffs.find((d) => d.planId === 'basic');
    const proDiff = result.priceDiffs.find((d) => d.planId === 'pro');

    expect(basicDiff?.vsCheapest).toBe(0);
    expect(proDiff?.vsCheapest).toBe(20);
    expect(basicDiff?.normalizedPrice).toBe(10);
    expect(result.priceDiffs.find((d) => d.planId === 'enterprise')?.normalizedPrice).toBe(100);
  });

  it('picks winners for cheapest, most features, and best value', () => {
    const result = comparePlans([basic, pro, enterprise]);
    expect(result.winners.cheapest).toBe('basic');
    expect(result.winners.mostFeatures).toBe('enterprise');
    expect(result.winners.bestValue).toBeTruthy();
  });

  it('computes category winners', () => {
    const result = comparePlans([basic, pro, enterprise]);
    expect(result.winners.byCategory.limits).toBe('enterprise');
    expect(result.winners.byCategory.security).toBe('enterprise');
  });

  it('filters to differences only when requested', () => {
    const withSame = comparePlans(
      [
        { ...basic, features: [...basic.features, { id: 'email', name: 'Email', value: true }] },
        { ...pro, features: [...pro.features, { id: 'email', name: 'Email', value: true }] },
      ],
      { highlightDifferencesOnly: true }
    );

    expect(withSame.featureMatrix.find((d) => d.featureId === 'email')).toBeUndefined();
    expect(withSame.featureMatrix.find((d) => d.featureId === 'api')).toBeDefined();
  });

  it('filters by category', () => {
    const result = comparePlans([basic, pro], { categories: ['integrations'] });
    expect(result.featureMatrix.every((d) => d.category === 'integrations')).toBe(true);
  });

  it('throws when fewer than two plans', () => {
    expect(() => comparePlans([basic])).toThrow(/at least two/i);
  });

  it('throws on duplicate plan ids', () => {
    expect(() => comparePlans([basic, { ...pro, id: 'basic' }])).toThrow(/duplicate/i);
  });

  it('normalizes price diffs to yearly when requested', () => {
    const result = comparePlans([basic, pro], { normalizeBillingCycle: 'yearly' });
    expect(result.priceDiffs.find((d) => d.planId === 'basic')?.normalizedPrice).toBe(120);
    expect(result.priceDiffs.find((d) => d.planId === 'pro')?.normalizedPrice).toBe(360);
  });
});

describe('recommendPlan', () => {
  const plans = [basic, pro, enterprise];

  it('ranks plans and assigns ranks starting at 1', () => {
    const profile: PreferenceProfile = {
      budget: 50,
      requiredFeatures: ['api'],
      usageLevel: 'moderate',
    };
    const recs = recommendPlan(plans, profile);

    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].rank).toBe(1);
    expect(recs.every((r) => r.score.total >= 0 && r.score.total <= 1)).toBe(true);
    expect(recs.find((r) => r.planId === 'basic')).toBeUndefined(); // missing api
  });

  it('excludes plans missing required features', () => {
    const recs = recommendPlan(plans, { requiredFeatures: ['sso'] });
    expect(recs.map((r) => r.planId)).toEqual(['enterprise']);
  });

  it('skips the current plan', () => {
    const recs = recommendPlan(plans, {
      currentPlanId: 'pro',
      requiredFeatures: ['api'],
    });
    expect(recs.find((r) => r.planId === 'pro')).toBeUndefined();
  });

  it('respects maxResults', () => {
    const recs = recommendPlan(plans, { maxResults: 1 });
    expect(recs).toHaveLength(1);
  });

  it('prefers value when prioritizeValue is set', () => {
    const valueFirst = recommendPlan(plans, {
      budget: 200,
      prioritizeValue: true,
      preferredFeatures: ['api', 'sso'],
    });
    const budgetFirst = recommendPlan(plans, {
      budget: 200,
      prioritizeValue: false,
      preferredFeatures: ['api', 'sso'],
    });

    expect(valueFirst[0].score.breakdown.valueScore).toBeDefined();
    expect(budgetFirst[0].reasons.length).toBeGreaterThan(0);
  });

  it('includes human-readable reasons', () => {
    const recs = recommendPlan(plans, {
      budget: 50,
      requiredFeatures: ['api'],
      preferredFeatures: ['users'],
      usageLevel: 'moderate',
    });
    expect(recs[0].reasons.length).toBeGreaterThan(0);
    expect(recs[0].estimatedMonthlyCost).toBeGreaterThan(0);
  });

  it('throws when plans array is empty', () => {
    expect(() => recommendPlan([], {})).toThrow(/at least one/i);
  });

  it('penalizes over-budget plans', () => {
    const recs = recommendPlan([basic, pro], { budget: 15 });
    const basicRec = recs.find((r) => r.planId === 'basic');
    const proRec = recs.find((r) => r.planId === 'pro');
    expect(basicRec!.score.breakdown.budgetFit).toBeGreaterThan(proRec!.score.breakdown.budgetFit);
  });
});

describe('PlanRecommendationTracker', () => {
  let tracker: PlanRecommendationTracker;

  beforeEach(() => {
    tracker = new PlanRecommendationTracker();
  });

  it('tracks recommendation events', () => {
    const event = tracker.track({
      recommendationId: 'rec_1',
      planId: 'pro',
      eventType: 'impression',
    });

    expect(event.id).toMatch(/^evt_/);
    expect(event.occurredAt).toBeGreaterThan(0);
    expect(tracker.getEvents()).toHaveLength(1);
  });

  it('records comparison pairs for analytics', () => {
    const comparison = comparePlans([basic, pro, enterprise]);
    tracker.recordComparison(comparison);

    const analytics = tracker.getAnalytics();
    expect(analytics.totalComparisons).toBe(1);
    expect(analytics.mostComparedPairs.length).toBeGreaterThan(0);
    expect(analytics.mostComparedPairs[0].count).toBe(1);
  });

  it('records top recommended plans', () => {
    const recs = recommendPlan([basic, pro, enterprise], {
      requiredFeatures: ['api'],
      budget: 50,
    });
    tracker.recordRecommendations(recs);

    const analytics = tracker.getAnalytics();
    expect(analytics.totalRecommendations).toBe(recs.length);
    expect(analytics.topRecommended[0].planId).toBe(recs[0].planId);
  });

  it('computes conversion and CTR', () => {
    tracker.track({ recommendationId: 'r1', planId: 'pro', eventType: 'impression' });
    tracker.track({ recommendationId: 'r1', planId: 'pro', eventType: 'impression' });
    tracker.track({ recommendationId: 'r1', planId: 'pro', eventType: 'click' });
    tracker.track({ recommendationId: 'r1', planId: 'pro', eventType: 'accept' });

    const analytics = tracker.getAnalytics();
    expect(analytics.impressions).toBe(2);
    expect(analytics.clicks).toBe(1);
    expect(analytics.accepts).toBe(1);
    expect(analytics.clickThroughRate).toBe(0.5);
    expect(analytics.conversionRate).toBe(0.5);
  });

  it('creates and resolves share tokens', () => {
    const comparison = comparePlans([basic, pro]);
    const share = tracker.createShare(comparison.id, ['basic', 'pro'], comparison, 60_000);

    expect(share.token).toMatch(/^pcs_/);
    expect(tracker.resolveShare(share.token)?.comparisonId).toBe(comparison.id);
    expect(tracker.resolveShare(share.token)?.payload?.id).toBe(comparison.id);
  });

  it('returns null for unknown or expired shares', () => {
    expect(tracker.resolveShare('missing')).toBeNull();

    const share = tracker.createShare('cmp_x', ['a', 'b'], undefined, -1);
    expect(tracker.resolveShare(share.token)).toBeNull();
  });

  it('resets all state', () => {
    tracker.track({ recommendationId: 'r', planId: 'pro', eventType: 'click' });
    tracker.recordComparison(comparePlans([basic, pro]));
    tracker.reset();

    const analytics = tracker.getAnalytics();
    expect(analytics.totalComparisons).toBe(0);
    expect(analytics.clicks).toBe(0);
    expect(tracker.getEvents()).toHaveLength(0);
  });
});

describe('module helpers', () => {
  const tracker = new PlanRecommendationTracker();

  beforeEach(() => {
    tracker.reset();
  });

  it('trackRecommendationEvent delegates to tracker', () => {
    const event = trackRecommendationEvent(
      { recommendationId: 'r', planId: 'pro', eventType: 'dismiss' },
      tracker
    );
    expect(event.eventType).toBe('dismiss');
    expect(getComparisonAnalytics(tracker).dismissals).toBe(1);
  });

  it('compareAndTrack records comparison + compare event', () => {
    const result = compareAndTrack([basic, pro], undefined, tracker);
    expect(result.plans).toHaveLength(2);
    expect(tracker.getAnalytics().totalComparisons).toBe(1);
    expect(tracker.getEvents().some((e) => e.eventType === 'compare')).toBe(true);
  });

  it('recommendAndTrack records recommendation counts', () => {
    const recs = recommendAndTrack([basic, pro], { budget: 40 }, tracker);
    expect(recs.length).toBeGreaterThan(0);
    expect(tracker.getAnalytics().totalRecommendations).toBe(recs.length);
  });

  it('createComparisonShare / resolveComparisonShare round-trip', () => {
    const share = createComparisonShare('cmp_1', ['basic', 'pro'], undefined, undefined, tracker);
    expect(resolveComparisonShare(share.token, tracker)?.planIds).toEqual(['basic', 'pro']);
  });
});
