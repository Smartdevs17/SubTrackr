/**
 * Tests for subscription CDN-cacheable endpoint controllers.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { getPlans, getPlanById } from '../plansController';
import { getPublicPricing } from '../pricingController';
import { getFeatures } from '../featuresController';
import { getPublicConfig } from '../publicController';
import {
  updatePlan,
  updatePricing,
  updateFeature,
  updatePublicConfig,
  purgeUserCache,
} from '../mutationController';
import { SURROGATE_KEY } from '../../../shared/cache/surrogateKeys';
import { NoOpCdnPurgeClient, CdnPurgeClient } from '../../../shared/cache/cdnPurgeClient';
import { publicDataStore } from '../../store/publicDataStore';

const noopPurge = new NoOpCdnPurgeClient();

// ── GET /plans ────────────────────────────────────────────────────────────────

describe('getPlans', () => {
  it('returns plans with plan surrogate keys', async () => {
    const result = await getPlans();
    expect(result.response.success).toBe(true);
    expect(result.response.data!.length).toBeGreaterThan(0);
    expect(result.surrogateKeys).toContain(SURROGATE_KEY.PLAN);
    expect(result.surrogateKeys).toContain('plan:free');
  });

  it('uses custom data provider', async () => {
    const result = await getPlans({
      listPlans: () => [{ id: 'custom', name: 'Custom', price: 1, currency: 'USD', billingCycle: 'monthly' }],
    });
    expect(result.response.data).toHaveLength(1);
    expect(result.surrogateKeys).toContain('plan:custom');
  });
});

describe('getPlanById', () => {
  it('returns single plan with scoped surrogate key', async () => {
    const result = await getPlanById('premium');
    expect(result).not.toBeNull();
    expect(result!.response.data!.id).toBe('premium');
    expect(result!.surrogateKeys).toEqual(['plan', 'plan:premium']);
  });

  it('returns null for unknown plan', async () => {
    const result = await getPlanById('nonexistent');
    expect(result).toBeNull();
  });
});

// ── GET /pricing ──────────────────────────────────────────────────────────────

describe('getPublicPricing', () => {
  it('returns pricing with pricing surrogate key', async () => {
    const result = await getPublicPricing();
    expect(result.response.success).toBe(true);
    expect(result.surrogateKeys).toEqual([SURROGATE_KEY.PRICING]);
  });
});

// ── GET /features ─────────────────────────────────────────────────────────────

describe('getFeatures', () => {
  it('returns features with feature surrogate key', () => {
    const result = getFeatures();
    expect(result.response.success).toBe(true);
    expect(result.surrogateKeys).toEqual([SURROGATE_KEY.FEATURE]);
  });

  it('handles empty feature list', () => {
    const result = getFeatures({ listPublicFeatures: () => [] });
    expect(result.response.data).toEqual([]);
    expect(result.surrogateKeys).toContain(SURROGATE_KEY.FEATURE);
  });
});

// ── GET /public/* ─────────────────────────────────────────────────────────────

describe('getPublicConfig', () => {
  it('returns all config entries for root path', () => {
    const result = getPublicConfig('');
    expect(result.response.success).toBe(true);
    expect(Array.isArray(result.response.data)).toBe(true);
    expect(result.surrogateKeys).toEqual([SURROGATE_KEY.CONFIG]);
  });

  it('returns scoped config for specific path', () => {
    const result = getPublicConfig('app/version');
    expect(result.response.data).toMatchObject({ key: 'app/version' });
    expect(result.surrogateKeys).toContain('config:app/version');
  });

  it('returns null value for unknown config key', () => {
    const result = getPublicConfig('unknown/key');
    expect(result.response.data).toMatchObject({ key: 'unknown/key', value: null });
  });
});

// ── Mutations with purge ──────────────────────────────────────────────────────

describe('mutation purge handlers', () => {
  beforeEach(() => {
    publicDataStore.reset();
  });

  it('updatePlan purges plan surrogate keys and persists', async () => {
    const result = await updatePlan('basic', { price: 5.99 }, undefined, noopPurge);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.response.data!.price).toBe(5.99);
      expect(result.result.purgeKeys).toContain(SURROGATE_KEY.PLAN);
    }
    expect(publicDataStore.getPlan('basic')?.price).toBe(5.99);
  });

  it('updatePricing purges pricing surrogate key and persists', async () => {
    const result = await updatePricing('basic', { monthlyPrice: 5.99 }, undefined, noopPurge);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.purgeKeys).toContain(SURROGATE_KEY.PRICING);
    }
    expect(publicDataStore.getPricing('basic')?.monthlyPrice).toBe(5.99);
  });

  it('updateFeature purges feature surrogate key', async () => {
    const result = await updateFeature('feat-1', false, undefined, noopPurge);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.purgeKeys).toContain(SURROGATE_KEY.FEATURE);
    }
    expect(publicDataStore.getFeatureOverride('feat-1')).toBe(false);
  });

  it('updatePublicConfig purges config surrogate keys and persists', async () => {
    const result = await updatePublicConfig('app/version', { minSupported: '2.0.0' }, undefined, noopPurge);
    expect(result.purgeKeys).toContain(SURROGATE_KEY.CONFIG);
    expect(publicDataStore.getPublicConfigEntry('app/version')).toEqual({ minSupported: '2.0.0' });
  });

  it('purgeUserCache does not throw', async () => {
    await expect(purgeUserCache('user-123', noopPurge)).resolves.toBeUndefined();
  });

  it('continues when purge API fails', async () => {
    const failingFetch = jest.fn(async () => {
      throw new Error('purge failed');
    }) as unknown as typeof fetch;

    const failingClient = new CdnPurgeClient({
      provider: 'fastly',
      apiToken: 'tok',
      serviceId: 'svc',
      fetchImpl: failingFetch,
    });

    const result = await updatePlan('basic', { price: 6.99 }, undefined, failingClient);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.response.data!.price).toBe(6.99);
    }
  });
});
