/**
 * Unit tests for planTemplateStore.ts
 *
 * Covers:
 *  - starter template library and browsing filters
 *  - dynamic pricing tiers and quoting
 *  - per-instantiation customization
 *  - versioning and supersession
 *  - sharing and access control
 *  - usage/conversion analytics, including the library roll-up
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  usePlanTemplateStore,
  quoteTemplate,
  quoteTiers,
  resolvePlan,
  canInstantiate,
  validateTemplateDraft,
  validateTiers,
  STARTER_TEMPLATES,
} from '../planTemplateStore';
import type { PlanTemplate, PlanTemplateDraft } from '../../types/planTemplate';
import { BillingCycle, SubscriptionCategory } from '../../types/subscription';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    setItem: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    getItem: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    removeItem: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
});

const OWNER = 'merchant_1';
const OTHER = 'merchant_2';

const flatDraft = (patch: Partial<PlanTemplateDraft> = {}): PlanTemplateDraft => ({
  name: 'Team',
  description: 'Collaboration tier',
  category: SubscriptionCategory.SOFTWARE,
  billingCycle: BillingCycle.MONTHLY,
  currency: 'USD',
  basePrice: 49,
  pricingModel: 'flat',
  tiers: [],
  features: [{ key: 'seats', label: 'Seats', includedUnits: 10 }],
  tags: ['team'],
  ...patch,
});

const tieredDraft = (patch: Partial<PlanTemplateDraft> = {}): PlanTemplateDraft =>
  flatDraft({
    name: 'Usage API',
    pricingModel: 'tiered',
    basePrice: 1,
    tiers: [
      { upToUnits: 1_000, unitPrice: 0 },
      { upToUnits: 10_000, unitPrice: 0.01 },
      { upToUnits: null, unitPrice: 0.005 },
    ],
    tags: ['api'],
    ...patch,
  });

const store = () => usePlanTemplateStore.getState();

beforeEach(() => {
  usePlanTemplateStore.setState({ templates: [], analytics: {}, filter: {}, error: null });
});

describe('pure helpers', () => {
  it('validates an ascending, terminally-unbounded ladder', () => {
    expect(validateTiers([])).toHaveLength(1);
    expect(
      validateTiers([
        { upToUnits: 1_000, unitPrice: 0 },
        { upToUnits: null, unitPrice: 1 },
      ])
    ).toEqual([]);
    expect(
      validateTiers([
        { upToUnits: null, unitPrice: 1 },
        { upToUnits: 50, unitPrice: 1 },
      ])
    ).toContain('Only the last tier may be unbounded.');
  });

  it('rejects a draft with a non-positive price', () => {
    const result = validateTemplateDraft(flatDraft({ basePrice: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Base price must be positive.');
  });

  it('prices units across a ladder supplied out of order', () => {
    const { total, lines } = quoteTiers(
      [
        { upToUnits: null, unitPrice: 0.005 },
        { upToUnits: 1_000, unitPrice: 0 },
        { upToUnits: 10_000, unitPrice: 0.01 },
      ],
      15_000
    );
    expect(total).toBeCloseTo(90 + 25);
    expect(lines[0].unitsInTier).toBe(1_000);
  });

  it('drops removed features when resolving a plan', () => {
    const template = {
      ...flatDraft({
        features: [
          { key: 'seats', label: 'Seats', includedUnits: 10 },
          { key: 'sso', label: 'SSO', includedUnits: null },
        ],
      }),
      id: 't1',
      rootId: 't1',
      version: 1,
      ownerId: OWNER,
      shared: false,
      active: true,
      createdAt: '',
      updatedAt: '',
    } as PlanTemplate;

    expect(resolvePlan(template, { removeFeatureKeys: ['sso'] }).features).toHaveLength(1);
    expect(canInstantiate(template, OTHER)).toBe(false);
  });
});

describe('library', () => {
  it('publishes a first version owned by its author', () => {
    const template = store().createTemplate(OWNER, flatDraft());

    expect(template.version).toBe(1);
    expect(template.rootId).toBe(template.id);
    expect(template.ownerId).toBe(OWNER);
    expect(template.shared).toBe(false);
    expect(store().getAnalytics(template.id).plansCreated).toBe(0);
  });

  it('throws and records the error for an invalid draft', () => {
    expect(() => store().createTemplate(OWNER, flatDraft({ basePrice: -1 }))).toThrow(
      /Base price must be positive/
    );
    expect(store().error).toMatch(/Base price must be positive/);
  });

  it('seeds starter templates only into an empty library', () => {
    expect(store().seedStarterTemplates(OWNER)).toHaveLength(STARTER_TEMPLATES.length);
    expect(store().seedStarterTemplates(OWNER)).toHaveLength(0);
    expect(store().templates).toHaveLength(STARTER_TEMPLATES.length);
  });

  it('filters by pricing model, tag and search text', () => {
    store().createTemplate(OWNER, flatDraft());
    store().createTemplate(OWNER, tieredDraft());

    expect(store().listTemplates({ pricingModel: 'tiered' })).toHaveLength(1);
    expect(store().listTemplates({ tags: ['api'] })).toHaveLength(1);
    expect(store().listTemplates({ search: 'usage' })).toHaveLength(1);
    expect(store().listTemplates({ search: 'no match' })).toHaveLength(0);
  });

  it('applies the stored filter when none is supplied', () => {
    store().createTemplate(OWNER, flatDraft());
    store().createTemplate(OWNER, tieredDraft());

    store().setFilter({ pricingModel: 'flat' });
    expect(store().listTemplates()).toHaveLength(1);

    store().clearFilter();
    expect(store().listTemplates()).toHaveLength(2);
  });
});

describe('pricing tiers', () => {
  it('quotes a tiered template across its ladder', () => {
    const template = store().createTemplate(OWNER, tieredDraft());

    expect(store().quote(template.id, 500)!.total).toBe(0);
    expect(store().quote(template.id, 2_000)!.total).toBeCloseTo(10);
    expect(store().quote(template.id, 15_000)!.total).toBeCloseTo(115);
  });

  it('quotes a flat template at its base price regardless of units', () => {
    const template = store().createTemplate(OWNER, flatDraft());
    expect(quoteTemplate(template, 100_000).total).toBe(49);
  });

  it('returns null for an unknown template', () => {
    expect(store().quote('missing', 10)).toBeNull();
  });
});

describe('customization', () => {
  it('applies overrides without mutating the template', () => {
    const template = store().createTemplate(OWNER, flatDraft());

    const resolved = store().instantiate(OWNER, template.id, { name: 'Team EU', price: 59 });

    expect(resolved).toMatchObject({ name: 'Team EU', price: 59, templateVersion: 1 });
    expect(store().getTemplate(template.id)).toMatchObject({ name: 'Team', basePrice: 49 });
  });

  it('refuses an override that zeroes the price', () => {
    const template = store().createTemplate(OWNER, flatDraft());
    expect(() => store().instantiate(OWNER, template.id, { price: 0 })).toThrow(
      /price must be positive/i
    );
  });
});

describe('versioning', () => {
  it('chains versions to the same root and retires the previous one', () => {
    const first = store().createTemplate(OWNER, flatDraft());
    const second = store().publishVersion(OWNER, first.id, flatDraft({ basePrice: 59 }));

    expect(second.version).toBe(2);
    expect(second.rootId).toBe(first.rootId);
    expect(store().getTemplate(first.id)!.active).toBe(false);
    expect(
      store()
        .listVersions(first.rootId)
        .map((v) => v.version)
    ).toEqual([1, 2]);
    expect(store().getLatestVersion(first.rootId)!.id).toBe(second.id);
  });

  it('leaves a superseded version readable but not instantiable', () => {
    const first = store().createTemplate(OWNER, flatDraft());
    store().publishVersion(OWNER, first.id, flatDraft({ basePrice: 59 }));

    expect(store().getTemplate(first.id)).toBeDefined();
    expect(() => store().instantiate(OWNER, first.id)).toThrow(/superseded/);
  });

  it('only lets the owner publish a new version', () => {
    const first = store().createTemplate(OWNER, flatDraft());
    expect(() => store().publishVersion(OTHER, first.id, flatDraft())).toThrow(/Only the owner/);
  });
});

describe('sharing', () => {
  it('opens a template to other merchants without letting them edit it', () => {
    const template = store().createTemplate(OWNER, flatDraft());
    expect(() => store().instantiate(OTHER, template.id)).toThrow(/not shared/);

    store().setShared(OWNER, template.id, true);
    expect(store().instantiate(OTHER, template.id).price).toBe(49);
    expect(() => store().publishVersion(OTHER, template.id, flatDraft())).toThrow(/Only the owner/);
  });

  it('carries sharing across versions and withdraws the superseded one', () => {
    const first = store().createTemplate(OWNER, flatDraft());
    store().setShared(OWNER, first.id, true);
    const second = store().publishVersion(OWNER, first.id, flatDraft({ basePrice: 59 }));

    expect(second.shared).toBe(true);
    expect(store().getTemplate(first.id)!.shared).toBe(false);
  });

  it('refuses to share a superseded version', () => {
    const first = store().createTemplate(OWNER, flatDraft());
    store().publishVersion(OWNER, first.id, flatDraft({ basePrice: 59 }));
    expect(() => store().setShared(OWNER, first.id, true)).toThrow(/superseded/);
  });

  it('lists a caller their own templates plus everything shared', () => {
    const mine = store().createTemplate(OWNER, flatDraft());
    const theirs = store().createTemplate(OTHER, flatDraft({ name: 'Their plan' }));
    store().setShared(OTHER, theirs.id, true);

    expect(
      store()
        .listAvailableTemplates(OWNER)
        .map((t) => t.id)
        .sort()
    ).toEqual([mine.id, theirs.id].sort());
  });
});

describe('analytics', () => {
  it('tracks adoption from views to plans', () => {
    const template = store().createTemplate(OWNER, flatDraft());
    store().recordView(template.id);
    store().recordView(template.id);
    store().instantiate(OWNER, template.id);

    expect(store().getAnalytics(template.id)).toMatchObject({
      views: 2,
      plansCreated: 1,
      adoptionRate: 0.5,
    });
  });

  it('tracks conversion and revenue per subscription', () => {
    const template = store().createTemplate(OWNER, flatDraft());
    store().instantiate(OWNER, template.id);
    store().instantiate(OWNER, template.id);
    store().recordSubscription(template.id, 49);

    expect(store().getAnalytics(template.id)).toMatchObject({
      conversionRate: 0.5,
      revenue: 49,
      averageRevenuePerSubscription: 49,
    });
  });

  it('gives each version its own analytics', () => {
    const first = store().createTemplate(OWNER, flatDraft());
    store().instantiate(OWNER, first.id);
    const second = store().publishVersion(OWNER, first.id, flatDraft({ basePrice: 59 }));

    expect(store().getAnalytics(first.id).plansCreated).toBe(1);
    expect(store().getAnalytics(second.id).plansCreated).toBe(0);
  });

  it('rolls the library up and ranks templates by subscriptions', () => {
    const popular = store().createTemplate(OWNER, flatDraft({ name: 'Popular' }));
    const quiet = store().createTemplate(OWNER, flatDraft({ name: 'Quiet' }));
    store().setShared(OWNER, popular.id, true);

    store().recordView(popular.id);
    store().instantiate(OWNER, popular.id);
    store().recordSubscription(popular.id, 100);
    store().instantiate(OWNER, quiet.id);

    const library = store().getLibraryAnalytics({ ownerId: OWNER });
    expect(library).toMatchObject({
      templates: 2,
      sharedTemplates: 1,
      totalPlansCreated: 2,
      totalSubscriptionsStarted: 1,
      totalRevenue: 100,
      conversionRate: 0.5,
    });
    expect(library.topTemplateIds).toEqual([popular.id]);
  });

  it('reports zeroes for an untouched template', () => {
    const template = store().createTemplate(OWNER, flatDraft());
    expect(store().getAnalytics(template.id)).toMatchObject({
      views: 0,
      conversionRate: 0,
      lastUsedAt: null,
    });
  });
});
