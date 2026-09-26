/**
 * Unit tests for planTemplateService.ts
 *
 * Covers:
 *  - template library CRUD and browsing filters
 *  - dynamic pricing tiers and quoting
 *  - per-instantiation customization
 *  - versioning and supersession
 *  - sharing and access control
 *  - usage/conversion analytics
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  InMemoryPlanTemplateRepository,
  PlanTemplateService,
  canInstantiate,
  quoteTemplate,
  resolvePlan,
  validateTemplateDraft,
  validateTiers,
} from '../planTemplateService';
import { BillingError } from '../errors';
import type { PlanTemplate, PlanTemplateDraft } from '../../../../src/types/planTemplate';
import { BillingCycle, SubscriptionCategory } from '../../../../src/types/subscription';

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
    ...patch,
  });

let service: PlanTemplateService;
let clock: Date;

beforeEach(() => {
  clock = new Date('2026-01-01T00:00:00.000Z');
  service = new PlanTemplateService(new InMemoryPlanTemplateRepository(), () => clock);
});

describe('validation', () => {
  it('accepts a well-formed flat draft', () => {
    expect(validateTemplateDraft(flatDraft()).valid).toBe(true);
  });

  it('requires a name, a positive price and a currency', () => {
    const result = validateTemplateDraft(flatDraft({ name: '  ', basePrice: 0, currency: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Template name is required.',
        'Base price must be positive.',
        'Currency is required.',
      ])
    );
  });

  it('rejects duplicate feature keys', () => {
    const result = validateTemplateDraft(
      flatDraft({
        features: [
          { key: 'seats', label: 'Seats', includedUnits: 1 },
          { key: 'seats', label: 'More seats', includedUnits: 5 },
        ],
      })
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Duplicate feature key "seats".');
  });

  it('warns rather than fails when a flat template carries unused tiers', () => {
    const result = validateTemplateDraft(
      flatDraft({ tiers: [{ upToUnits: null, unitPrice: 1 }] })
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('Pricing tiers are ignored by a flat-priced template.');
  });

  it('requires an ascending, terminally-unbounded ladder', () => {
    expect(validateTiers([])).toHaveLength(1);
    expect(
      validateTiers([
        { upToUnits: 10_000, unitPrice: 1 },
        { upToUnits: 1_000, unitPrice: 1 },
      ])
    ).toContain("Tier 2 must exceed the previous tier's upper bound.");
    expect(
      validateTiers([
        { upToUnits: null, unitPrice: 1 },
        { upToUnits: 50, unitPrice: 1 },
      ])
    ).toContain('Only the last tier may be unbounded.');
    expect(validateTiers([{ upToUnits: null, unitPrice: -1 }])).toContain(
      'Tier 1 has a negative unit price.'
    );
  });
});

describe('library', () => {
  it('publishes a first version owned by its author', async () => {
    const template = await service.createTemplate(OWNER, flatDraft());

    expect(template.version).toBe(1);
    expect(template.rootId).toBe(template.id);
    expect(template.ownerId).toBe(OWNER);
    expect(template.shared).toBe(false);
    expect(template.active).toBe(true);
  });

  it('refuses to publish an invalid draft', async () => {
    await expect(service.createTemplate(OWNER, flatDraft({ basePrice: -1 }))).rejects.toBeInstanceOf(
      BillingError
    );
  });

  it('filters the library by pricing model, tag and search text', async () => {
    await service.createTemplate(OWNER, flatDraft());
    await service.createTemplate(OWNER, tieredDraft({ tags: ['api'] }));

    expect(await service.listTemplates({ pricingModel: 'tiered' })).toHaveLength(1);
    expect(await service.listTemplates({ tags: ['api'] })).toHaveLength(1);
    expect(await service.listTemplates({ search: 'collaboration' })).toHaveLength(2);
    expect(await service.listTemplates({ search: 'nothing here' })).toHaveLength(0);
  });

  it('hides superseded versions from the library by default', async () => {
    const first = await service.createTemplate(OWNER, flatDraft());
    await service.publishVersion(OWNER, first.id, flatDraft({ basePrice: 59 }));

    expect(await service.listTemplates()).toHaveLength(1);
    expect(await service.listTemplates({ includeInactive: true })).toHaveLength(2);
  });
});

describe('pricing tiers', () => {
  let tiered: PlanTemplate;

  beforeEach(async () => {
    tiered = await service.createTemplate(OWNER, tieredDraft());
  });

  it('prices units across the ladder', async () => {
    expect((await service.quote(tiered.id, 500)).total).toBe(0);
    // 1,000 free, then 1,000 at 0.01.
    expect((await service.quote(tiered.id, 2_000)).total).toBeCloseTo(10);
    // 1,000 free, 9,000 at 0.01, 5,000 at 0.005.
    expect((await service.quote(tiered.id, 15_000)).total).toBeCloseTo(90 + 25);
  });

  it('reports the per-tier breakdown and effective unit price', async () => {
    const quote = await service.quote(tiered.id, 2_000);
    expect(quote.lines).toHaveLength(2);
    expect(quote.lines[0].unitsInTier).toBe(1_000);
    expect(quote.lines[1].amount).toBeCloseTo(10);
    expect(quote.effectiveUnitPrice).toBeCloseTo(0.005);
  });

  it('quotes a flat template at its base price regardless of units', async () => {
    const flat = await service.createTemplate(OWNER, flatDraft());
    expect(quoteTemplate(flat, 0).total).toBe(49);
    expect(quoteTemplate(flat, 100_000).total).toBe(49);
  });

  it('treats negative units as zero', async () => {
    expect((await service.quote(tiered.id, -5)).units).toBe(0);
  });
});

describe('customization', () => {
  it('applies overrides without mutating the template', async () => {
    const template = await service.createTemplate(OWNER, flatDraft());

    const resolved = await service.instantiate(OWNER, template.id, {
      name: 'Team (EU)',
      price: 59,
      currency: 'EUR',
    });

    expect(resolved).toMatchObject({ name: 'Team (EU)', price: 59, currency: 'EUR' });
    expect(await service.getTemplate(template.id)).toMatchObject({
      name: 'Team',
      basePrice: 49,
      currency: 'USD',
    });
  });

  it('drops features the caller removed', () => {
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

    const resolved = resolvePlan(template, { removeFeatureKeys: ['sso'] });
    expect(resolved.features.map((f) => f.key)).toEqual(['seats']);
  });

  it('refuses an override that zeroes the price', async () => {
    const template = await service.createTemplate(OWNER, flatDraft());
    await expect(service.instantiate(OWNER, template.id, { price: 0 })).rejects.toThrow(
      /price must be positive/i
    );
  });
});

describe('versioning', () => {
  it('chains versions to the same root and retires the previous one', async () => {
    const first = await service.createTemplate(OWNER, flatDraft());
    const second = await service.publishVersion(OWNER, first.id, flatDraft({ basePrice: 59 }));

    expect(second.version).toBe(2);
    expect(second.rootId).toBe(first.rootId);
    expect((await service.getTemplate(first.id))!.active).toBe(false);

    const versions = await service.listVersions(first.rootId);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect((await service.getLatestVersion(first.rootId))!.id).toBe(second.id);
  });

  it('leaves a superseded version readable but not instantiable', async () => {
    const first = await service.createTemplate(OWNER, flatDraft());
    await service.publishVersion(OWNER, first.id, flatDraft({ basePrice: 59 }));

    expect(await service.getTemplate(first.id)).not.toBeNull();
    await expect(service.instantiate(OWNER, first.id)).rejects.toThrow(/superseded/);
  });

  it('gives each version its own analytics', async () => {
    const first = await service.createTemplate(OWNER, flatDraft());
    await service.instantiate(OWNER, first.id);
    const second = await service.publishVersion(OWNER, first.id, flatDraft({ basePrice: 59 }));

    expect((await service.getAnalytics(first.id)).plansCreated).toBe(1);
    expect((await service.getAnalytics(second.id)).plansCreated).toBe(0);
  });

  it('only lets the owner publish a new version', async () => {
    const first = await service.createTemplate(OWNER, flatDraft());
    await expect(service.publishVersion(OTHER, first.id, flatDraft())).rejects.toThrow(
      /Only the owner/
    );
  });
});

describe('sharing', () => {
  it('lets another merchant instantiate a shared template but not edit it', async () => {
    const template = await service.createTemplate(OWNER, flatDraft());
    await expect(service.instantiate(OTHER, template.id)).rejects.toThrow(/not shared/);

    await service.setShared(OWNER, template.id, true);
    await expect(service.instantiate(OTHER, template.id)).resolves.toMatchObject({ price: 49 });
    await expect(service.publishVersion(OTHER, template.id, flatDraft())).rejects.toThrow(
      /Only the owner/
    );
  });

  it('carries sharing across versions and withdraws the superseded one', async () => {
    const first = await service.createTemplate(OWNER, flatDraft());
    await service.setShared(OWNER, first.id, true);
    const second = await service.publishVersion(OWNER, first.id, flatDraft({ basePrice: 59 }));

    expect(second.shared).toBe(true);
    expect((await service.getTemplate(first.id))!.shared).toBe(false);
  });

  it('refuses to share a superseded version', async () => {
    const first = await service.createTemplate(OWNER, flatDraft());
    await service.publishVersion(OWNER, first.id, flatDraft({ basePrice: 59 }));

    await expect(service.setShared(OWNER, first.id, true)).rejects.toThrow(/superseded/);
  });

  it('lists a caller their own templates plus everything shared', async () => {
    const mine = await service.createTemplate(OWNER, flatDraft());
    const theirs = await service.createTemplate(OTHER, flatDraft({ name: 'Their plan' }));
    await service.setShared(OTHER, theirs.id, true);

    const available = await service.listAvailableTemplates(OWNER);
    expect(available.map((t) => t.id).sort()).toEqual([mine.id, theirs.id].sort());
  });

  it('agrees with the standalone access check', async () => {
    const template = await service.createTemplate(OWNER, flatDraft());
    expect(canInstantiate(template, OWNER)).toBe(true);
    expect(canInstantiate(template, OTHER)).toBe(false);
    expect(canInstantiate({ ...template, shared: true }, OTHER)).toBe(true);
    expect(canInstantiate({ ...template, active: false }, OWNER)).toBe(false);
  });
});

describe('analytics', () => {
  it('starts empty', async () => {
    const template = await service.createTemplate(OWNER, flatDraft());
    expect(await service.getAnalytics(template.id)).toMatchObject({
      views: 0,
      plansCreated: 0,
      subscriptionsStarted: 0,
      adoptionRate: 0,
      conversionRate: 0,
    });
  });

  it('tracks adoption from views to plans', async () => {
    const template = await service.createTemplate(OWNER, flatDraft());
    await service.recordView(template.id);
    await service.recordView(template.id);
    await service.recordView(template.id);
    await service.recordView(template.id);
    await service.instantiate(OWNER, template.id);

    expect(await service.getAnalytics(template.id)).toMatchObject({
      views: 4,
      plansCreated: 1,
      adoptionRate: 0.25,
    });
  });

  it('tracks conversion and revenue per subscription', async () => {
    const template = await service.createTemplate(OWNER, flatDraft());
    await service.instantiate(OWNER, template.id);
    await service.instantiate(OWNER, template.id);
    await service.recordSubscription(template.id, 49);

    const analytics = await service.getAnalytics(template.id);
    expect(analytics.conversionRate).toBe(0.5);
    expect(analytics.revenue).toBe(49);
    expect(analytics.averageRevenuePerSubscription).toBe(49);
    expect(analytics.lastUsedAt).toBe(clock.toISOString());
  });

  it('caps a rate at 100% when conversions outrun plans', async () => {
    const template = await service.createTemplate(OWNER, flatDraft());
    await service.instantiate(OWNER, template.id);
    await service.recordSubscription(template.id);
    await service.recordSubscription(template.id);

    expect((await service.getAnalytics(template.id)).conversionRate).toBe(1);
  });

  it('rolls the library up and ranks templates by subscriptions', async () => {
    const popular = await service.createTemplate(OWNER, flatDraft({ name: 'Popular' }));
    const quiet = await service.createTemplate(OWNER, flatDraft({ name: 'Quiet' }));
    await service.setShared(OWNER, popular.id, true);

    await service.recordView(popular.id);
    await service.instantiate(OWNER, popular.id);
    await service.recordSubscription(popular.id, 100);
    await service.recordSubscription(popular.id, 100);
    await service.instantiate(OWNER, quiet.id);

    const library = await service.getLibraryAnalytics({ ownerId: OWNER });
    expect(library).toMatchObject({
      templates: 2,
      sharedTemplates: 1,
      totalPlansCreated: 2,
      totalSubscriptionsStarted: 2,
      totalRevenue: 200,
    });
    expect(library.topTemplateIds).toEqual([popular.id]);
  });
});
