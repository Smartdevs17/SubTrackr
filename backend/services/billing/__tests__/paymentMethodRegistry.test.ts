/**
 * Unit tests for paymentMethodRegistry.ts
 *
 * Covers:
 *  - payment method CRUD and verification
 *  - fallback chain configuration and validation
 *  - charging through a chain, including hard-decline halts
 *  - expiry tracking with alerts
 *  - payment method sharing and its spend limits
 *  - success/failure analytics including fallback usage
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  PaymentMethodRegistry,
  MAX_CHAIN_LENGTH,
  type ChargeProcessor,
  type PaymentMethodDraft,
  type RegisteredPaymentMethod,
} from '../paymentMethodRegistry';
import { BillingError } from '../errors';

const MERCHANT = 'merchant_1';
const OTHER = 'merchant_2';
const SUBSCRIPTION = 'sub_1';
const DAY_MS = 24 * 60 * 60 * 1000;

let clock: Date;
let registry: PaymentMethodRegistry;

const inDays = (days: number): string => new Date(clock.getTime() + days * DAY_MS).toISOString();

const draft = (patch: Partial<PaymentMethodDraft> = {}): PaymentMethodDraft => ({
  label: 'Primary USDC',
  kind: 'crypto',
  reference: '0xabc…def',
  currency: 'USD',
  spendLimit: 0,
  expiresAt: null,
  ...patch,
});

const addVerified = (patch: Partial<PaymentMethodDraft> = {}): RegisteredPaymentMethod => {
  const method = registry.addMethod(MERCHANT, draft(patch));
  return method.isVerified ? method : registry.verifyMethod(method.id);
};

/** A processor that declines on the listed method ids. */
const declineOn = (...methodIds: string[]): ChargeProcessor =>
  async ({ method }) =>
    methodIds.includes(method.id) ? { success: false, failureReason: 'declined' } : { success: true };

beforeEach(() => {
  clock = new Date('2026-03-01T12:00:00.000Z');
  registry = new PaymentMethodRegistry(async () => ({ success: true }), () => clock);
});

describe('method CRUD', () => {
  it('registers a crypto method as already verified', () => {
    const method = registry.addMethod(MERCHANT, draft());
    expect(method.isVerified).toBe(true);
    expect(method.isActive).toBe(true);
    expect(method.lastUsedAt).toBeNull();
  });

  it('requires an explicit verification for non-crypto kinds', () => {
    const method = registry.addMethod(MERCHANT, draft({ kind: 'card' }));
    expect(method.isVerified).toBe(false);
    expect(registry.verifyMethod(method.id).isVerified).toBe(true);
  });

  it('rejects an unlabelled method or a negative spend limit', () => {
    expect(() => registry.addMethod(MERCHANT, draft({ label: '  ' }))).toThrow(BillingError);
    expect(() => registry.addMethod(MERCHANT, draft({ spendLimit: -1 }))).toThrow(/negative/);
  });

  it('lists only a merchant own active methods by default', () => {
    const mine = addVerified();
    registry.addMethod(OTHER, draft({ label: 'Theirs' }));
    const retired = addVerified({ label: 'Retired' });
    registry.updateMethod(retired.id, {});
    registry.removeMethod(retired.id);

    expect(registry.listMethods(MERCHANT).map((m) => m.id)).toEqual([mine.id]);
  });

  it('drops a removed method from every chain', () => {
    const first = addVerified({ label: 'First' });
    const second = addVerified({ label: 'Second' });
    const chain = registry.createChain(MERCHANT, 'Main', [first.id, second.id]);

    registry.removeMethod(first.id);
    expect(registry.getChain(chain.id)!.methodIds).toEqual([second.id]);
  });

  it('deactivates methods whose expiry has passed', () => {
    addVerified({ label: 'Expired', expiresAt: inDays(-1) });
    addVerified({ label: 'Live', expiresAt: inDays(60) });

    expect(registry.deactivateExpired(MERCHANT)).toBe(1);
    expect(registry.listMethods(MERCHANT).map((m) => m.label)).toEqual(['Live']);
  });
});

describe('fallback chains', () => {
  it('validates length, duplicates and ownership', () => {
    const method = addVerified();
    const theirs = registry.addMethod(OTHER, draft({ label: 'Theirs' }));

    expect(() => registry.createChain(MERCHANT, '', [method.id])).toThrow(/name is required/);
    expect(() => registry.createChain(MERCHANT, 'Empty', [])).toThrow(/at least one/);
    expect(() => registry.createChain(MERCHANT, 'Dupe', [method.id, method.id])).toThrow(
      /appears twice/
    );
    expect(() => registry.createChain(MERCHANT, 'Alien', [theirs.id])).toThrow(
      /belongs to another merchant/
    );
    expect(() => registry.createChain(MERCHANT, 'Missing', ['pm_nope'])).toThrow(/does not exist/);
  });

  it('rejects a chain longer than the ceiling', () => {
    const ids = Array.from({ length: MAX_CHAIN_LENGTH + 1 }, (_, i) =>
      addVerified({ label: `M${i}` }).id
    );
    expect(() => registry.createChain(MERCHANT, 'Too long', ids)).toThrow(/at most/);
  });

  it('warns about a single-method chain', () => {
    const method = addVerified();
    const chain = registry.createChain(MERCHANT, 'Solo', [method.id]);
    expect(registry.validateChain(chain).warnings).toContain(
      'A single-method chain has no fallback if that method fails.'
    );
  });

  it('excludes unusable methods when resolving a chain', () => {
    const live = addVerified({ label: 'Live' });
    const unverified = registry.addMethod(MERCHANT, draft({ label: 'Unverified', kind: 'card' }));
    const expired = addVerified({ label: 'Expired', expiresAt: inDays(-1) });

    const chain = registry.createChain(MERCHANT, 'Mixed', [live.id, unverified.id, expired.id]);
    expect(registry.resolveChainMethods(chain).map((m) => m.id)).toEqual([live.id]);
    expect(registry.validateChain(chain).warnings.join(' ')).toMatch(/inactive, unverified/);
  });

  it('caps a chain at maxAttempts', () => {
    const ids = [addVerified({ label: 'A' }).id, addVerified({ label: 'B' }).id];
    const chain = registry.createChain(MERCHANT, 'Capped', ids, { maxAttempts: 1 });
    expect(registry.resolveChainMethods(chain)).toHaveLength(1);
  });

  it('prefers a subscription chain over the global one', () => {
    const method = addVerified();
    const global = registry.createChain(MERCHANT, 'Global', [method.id]);
    const scoped = registry.createChain(MERCHANT, 'Scoped', [method.id], {
      subscriptionId: SUBSCRIPTION,
    });

    expect(registry.chainForSubscription(MERCHANT, SUBSCRIPTION)!.id).toBe(scoped.id);
    expect(registry.chainForSubscription(MERCHANT, 'sub_other')!.id).toBe(global.id);
  });

  it('ignores an inactive chain', () => {
    const method = addVerified();
    const chain = registry.createChain(MERCHANT, 'Global', [method.id]);
    registry.updateChain(chain.id, { isActive: false });

    expect(registry.chainForSubscription(MERCHANT, SUBSCRIPTION)).toBeNull();
  });
});

describe('charging through a chain', () => {
  it('succeeds on the first usable method', async () => {
    const first = addVerified({ label: 'First' });
    const second = addVerified({ label: 'Second' });
    registry.createChain(MERCHANT, 'Main', [first.id, second.id]);

    const result = await registry.charge(MERCHANT, SUBSCRIPTION, 100);
    expect(result.success).toBe(true);
    expect(result.succeededMethodId).toBe(first.id);
    expect(result.succeededAtPosition).toBe(0);
    expect(result.attempts).toHaveLength(1);
    expect(registry.getMethod(first.id)!.lastUsedAt).toBe(clock.toISOString());
  });

  it('falls through to the next method on a decline', async () => {
    const first = addVerified({ label: 'First' });
    const second = addVerified({ label: 'Second' });
    registry.createChain(MERCHANT, 'Main', [first.id, second.id]);

    const result = await registry.charge(MERCHANT, SUBSCRIPTION, 100, declineOn(first.id));
    expect(result.success).toBe(true);
    expect(result.succeededMethodId).toBe(second.id);
    expect(result.succeededAtPosition).toBe(1);
    expect(result.attempts.map((a) => a.success)).toEqual([false, true]);
  });

  it('skips a method whose spend limit the charge exceeds', async () => {
    const capped = addVerified({ label: 'Capped', spendLimit: 50 });
    const open = addVerified({ label: 'Open' });
    registry.createChain(MERCHANT, 'Main', [capped.id, open.id]);

    const result = await registry.charge(MERCHANT, SUBSCRIPTION, 100);
    expect(result.attempts[0].failureReason).toBe('limit_exceeded');
    expect(result.succeededMethodId).toBe(open.id);
  });

  it('halts on a hard decline when configured to', async () => {
    const expired = addVerified({ label: 'Expired', expiresAt: inDays(-1) });
    const healthy = addVerified({ label: 'Healthy' });
    registry.createChain(MERCHANT, 'Strict', [expired.id, healthy.id], {
      stopOnHardDecline: true,
    });

    const result = await registry.charge(MERCHANT, SUBSCRIPTION, 100);
    expect(result.haltedOnHardDecline).toBe(true);
    expect(result.success).toBe(false);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].failureReason).toBe('expired');
  });

  it('falls through a hard decline by default', async () => {
    const expired = addVerified({ label: 'Expired', expiresAt: inDays(-1) });
    const healthy = addVerified({ label: 'Healthy' });
    registry.createChain(MERCHANT, 'Lenient', [expired.id, healthy.id]);

    const result = await registry.charge(MERCHANT, SUBSCRIPTION, 100);
    expect(result.success).toBe(true);
    expect(result.succeededMethodId).toBe(healthy.id);
  });

  it('falls back to every method when no chain is configured', async () => {
    const first = addVerified({ label: 'First' });
    const second = addVerified({ label: 'Second' });

    const result = await registry.charge(MERCHANT, SUBSCRIPTION, 100, declineOn(first.id));
    expect(result.chainId).toBeNull();
    expect(result.succeededMethodId).toBe(second.id);
  });

  it('reports failure when every method declines', async () => {
    const first = addVerified({ label: 'First' });
    const second = addVerified({ label: 'Second' });
    registry.createChain(MERCHANT, 'Main', [first.id, second.id]);

    const result = await registry.charge(MERCHANT, SUBSCRIPTION, 100, declineOn(first.id, second.id));
    expect(result.success).toBe(false);
    expect(result.succeededAtPosition).toBe(-1);
    expect(result.attempts).toHaveLength(2);
  });

  it('throws when the merchant has no payment method at all', async () => {
    await expect(registry.charge(MERCHANT, SUBSCRIPTION, 100)).rejects.toThrow(
      /No payment method available/
    );
  });
});

describe('expiry alerts', () => {
  it('grades severity by how close the expiry is', () => {
    addVerified({ label: 'Expired', expiresAt: inDays(-2) });
    addVerified({ label: 'Critical', expiresAt: inDays(3) });
    addVerified({ label: 'Warning', expiresAt: inDays(20) });
    addVerified({ label: 'Fine', expiresAt: inDays(90) });
    addVerified({ label: 'Perpetual' });

    const alerts = registry.getExpiryAlerts(MERCHANT);
    expect(alerts.map((a) => a.severity)).toEqual(['expired', 'critical', 'warning']);
    expect(alerts[0].message).toMatch(/expired 2 day\(s\) ago/);
    expect(alerts[1].message).toMatch(/expires in 3 day\(s\)/);
  });

  it('flags a method that is still in an active chain', () => {
    const chained = addVerified({ label: 'Chained', expiresAt: inDays(3) });
    addVerified({ label: 'Loose', expiresAt: inDays(4) });
    registry.createChain(MERCHANT, 'Main', [chained.id]);

    const alerts = registry.getExpiryAlerts(MERCHANT);
    expect(alerts[0]).toMatchObject({ methodId: chained.id, inActiveChain: true });
    expect(alerts[0].message).toMatch(/still in a fallback chain/);
    expect(alerts[1].inActiveChain).toBe(false);
  });

  it('honours a narrower window', () => {
    addVerified({ label: 'Soon', expiresAt: inDays(5) });
    addVerified({ label: 'Later', expiresAt: inDays(20) });

    expect(registry.getExpiryAlerts(MERCHANT, 7)).toHaveLength(1);
  });
});

describe('sharing', () => {
  it('grants and revokes access to a method', () => {
    const method = addVerified();
    const share = registry.shareMethod(method.id, OTHER, 'viewer');

    expect(registry.listShares(method.id)).toHaveLength(1);
    expect(registry.methodsSharedWith(OTHER).map((m) => m.id)).toEqual([method.id]);

    registry.revokeShare(share.id);
    expect(registry.listShares(method.id)).toHaveLength(0);
    expect(registry.methodsSharedWith(OTHER)).toEqual([]);
  });

  it('lets only a charger spend, within its limit', () => {
    const method = addVerified();
    registry.shareMethod(method.id, 'viewer_1', 'viewer');
    registry.shareMethod(method.id, 'charger_1', 'charger', { spendLimit: 100 });

    expect(registry.canGranteeCharge(method.id, 'viewer_1', 10)).toBe(false);
    expect(registry.canGranteeCharge(method.id, 'charger_1', 100)).toBe(true);
    expect(registry.canGranteeCharge(method.id, 'charger_1', 101)).toBe(false);
    expect(registry.canGranteeCharge(method.id, 'stranger', 1)).toBe(false);
  });

  it('treats an elapsed share as revoked', () => {
    const method = addVerified();
    registry.shareMethod(method.id, OTHER, 'charger', { expiresAt: inDays(1) });

    expect(registry.canGranteeCharge(method.id, OTHER, 10)).toBe(true);
    clock = new Date(clock.getTime() + 2 * DAY_MS);
    expect(registry.canGranteeCharge(method.id, OTHER, 10)).toBe(false);
  });

  it('refuses to share with the owner or from an inactive method', () => {
    const method = addVerified();
    expect(() => registry.shareMethod(method.id, MERCHANT, 'viewer')).toThrow(/its own owner/);
    expect(() => registry.shareMethod(method.id, '  ', 'viewer')).toThrow(/needs a grantee/);

    addVerified({ label: 'Expired', expiresAt: inDays(-1) });
    registry.deactivateExpired(MERCHANT);
    const inactive = registry.listMethods(MERCHANT, true).find((m) => !m.isActive)!;
    expect(() => registry.shareMethod(inactive.id, OTHER, 'viewer')).toThrow(/inactive/);
  });
});

describe('analytics', () => {
  it('reports zeroes before any charge', () => {
    addVerified();
    const analytics = registry.getAnalytics(MERCHANT);
    expect(analytics).toMatchObject({
      totalAttempts: 0,
      successRate: 0,
      fallbackRate: 0,
      activeMethods: 1,
    });
  });

  it('computes success rates per method', async () => {
    const first = addVerified({ label: 'First' });
    const second = addVerified({ label: 'Second' });
    registry.createChain(MERCHANT, 'Main', [first.id, second.id]);

    await registry.charge(MERCHANT, SUBSCRIPTION, 100, declineOn(first.id));
    await registry.charge(MERCHANT, SUBSCRIPTION, 100, declineOn(first.id));

    const analytics = registry.getAnalytics(MERCHANT);
    expect(analytics.totalAttempts).toBe(4);
    expect(analytics.successRate).toBe(0.5);
    expect(analytics.byMethod.find((m) => m.methodId === first.id)!.successRate).toBe(0);
    expect(analytics.byMethod.find((m) => m.methodId === second.id)!.volume).toBe(200);
    expect(analytics.mostReliableMethodId).toBe(second.id);
  });

  it('measures how often the fallback earns its keep', async () => {
    const first = addVerified({ label: 'First' });
    const second = addVerified({ label: 'Second' });
    registry.createChain(MERCHANT, 'Main', [first.id, second.id]);

    // One charge lands on the head of the chain, one only on the fallback.
    await registry.charge(MERCHANT, SUBSCRIPTION, 100);
    await registry.charge(MERCHANT, SUBSCRIPTION, 100, declineOn(first.id));

    expect(registry.getAnalytics(MERCHANT).fallbackRate).toBe(0.5);
  });

  it('ranks failure reasons', async () => {
    const capped = addVerified({ label: 'Capped', spendLimit: 10 });
    const open = addVerified({ label: 'Open' });
    registry.createChain(MERCHANT, 'Main', [capped.id, open.id]);

    await registry.charge(MERCHANT, SUBSCRIPTION, 100);
    await registry.charge(MERCHANT, SUBSCRIPTION, 100, declineOn(capped.id, open.id));

    const analytics = registry.getAnalytics(MERCHANT);
    expect(analytics.failureReasons[0]).toMatchObject({ reason: 'limit_exceeded', count: 2 });
    expect(analytics.byMethod.find((m) => m.methodId === capped.id)!.topFailureReason).toBe(
      'limit_exceeded'
    );
  });

  it('counts methods approaching expiry but not those already expired', () => {
    addVerified({ label: 'Soon', expiresAt: inDays(3) });
    addVerified({ label: 'Gone', expiresAt: inDays(-3) });

    expect(registry.getAnalytics(MERCHANT).expiringMethods).toBe(1);
  });

  it('keeps one merchant analytics out of another', async () => {
    const mine = addVerified();
    registry.createChain(MERCHANT, 'Main', [mine.id]);
    await registry.charge(MERCHANT, SUBSCRIPTION, 100);

    expect(registry.getAnalytics(OTHER).totalAttempts).toBe(0);
  });
});
