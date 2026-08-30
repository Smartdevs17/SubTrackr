/**
 * Plan template library state.
 *
 * Holds the merchant's own templates plus everything shared with them, tracks
 * per-template usage analytics, and resolves a template into the concrete plan
 * parameters `subscriptionStore.addFromTemplate` consumes.
 *
 * Templates are immutable once published: `publishVersion` chains a new version
 * to the same root and retires the previous one, so plans already created from
 * an earlier version stay explainable.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { debouncedAsyncStorageAdapter } from '../utils/storage';
import {
  PlanTemplate,
  PlanTemplateDraft,
  ResolvedPlan,
  TemplateAnalytics,
  TemplateFeature,
  TemplateFilter,
  TemplateLibraryAnalytics,
  TemplateOverrides,
  TemplateQuote,
  TemplateQuoteLine,
  TemplateValidationResult,
} from '../types/planTemplate';
import { BillingCycle, SubscriptionCategory } from '../types/subscription';
import type { PricingTier } from '../types/usage';

const STORAGE_KEY = 'subtrackr-plan-templates';

/** Ceiling on tiers in one template, bounding the cost of a price quote. */
export const MAX_TIERS = 12;

/** Ceiling on features listed by one template. */
export const MAX_FEATURES = 32;

const generateId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `tpl_${timestamp}_${random}`;
};

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : Math.min(1, numerator / denominator);

export const emptyTemplateAnalytics = (templateId: string): TemplateAnalytics => ({
  templateId,
  views: 0,
  plansCreated: 0,
  subscriptionsStarted: 0,
  revenue: 0,
  adoptionRate: 0,
  conversionRate: 0,
  averageRevenuePerSubscription: 0,
  lastUsedAt: null,
});

const withDerivedRates = (analytics: TemplateAnalytics): TemplateAnalytics => ({
  ...analytics,
  adoptionRate: ratio(analytics.plansCreated, analytics.views),
  conversionRate: ratio(analytics.subscriptionsStarted, analytics.plansCreated),
  averageRevenuePerSubscription:
    analytics.subscriptionsStarted === 0 ? 0 : analytics.revenue / analytics.subscriptionsStarted,
});

// ── Pure helpers ─────────────────────────────────────────────────────

/**
 * A ladder is valid when it is non-empty within `MAX_TIERS`, strictly
 * ascending, priced non-negatively, and unbounded only on its last rung.
 */
export function validateTiers(tiers: PricingTier[]): string[] {
  const errors: string[] = [];
  if (tiers.length === 0) {
    errors.push('A tiered template needs at least one pricing tier.');
    return errors;
  }
  if (tiers.length > MAX_TIERS) {
    errors.push(`A template supports at most ${MAX_TIERS} pricing tiers.`);
  }

  let previous = 0;
  tiers.forEach((tier, index) => {
    if (tier.unitPrice < 0) {
      errors.push(`Tier ${index + 1} has a negative unit price.`);
    }
    if (tier.upToUnits === null) {
      if (index !== tiers.length - 1) {
        errors.push('Only the last tier may be unbounded.');
      }
      return;
    }
    if (tier.upToUnits <= previous) {
      errors.push(`Tier ${index + 1} must exceed the previous tier's upper bound.`);
    }
    previous = tier.upToUnits;
  });

  return errors;
}

export function validateTemplateDraft(draft: PlanTemplateDraft): TemplateValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!draft.name?.trim()) errors.push('Template name is required.');
  if (draft.basePrice <= 0) errors.push('Base price must be positive.');
  if (!draft.currency?.trim()) errors.push('Currency is required.');
  if (draft.features.length > MAX_FEATURES) {
    errors.push(`A template supports at most ${MAX_FEATURES} features.`);
  }

  const seen = new Set<string>();
  for (const feature of draft.features) {
    if (seen.has(feature.key)) errors.push(`Duplicate feature key "${feature.key}".`);
    seen.add(feature.key);
  }

  if (draft.pricingModel === 'tiered') {
    errors.push(...validateTiers(draft.tiers));
  } else if (draft.tiers.length > 0) {
    warnings.push('Pricing tiers are ignored by a flat-priced template.');
  }

  if (!draft.description?.trim()) {
    warnings.push('A description helps merchants pick the right template.');
  }
  if (draft.features.length === 0) {
    warnings.push('Templates without features are hard to compare.');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Price `units` against a graduated ladder, with the per-tier breakdown. */
export function quoteTiers(
  tiers: PricingTier[],
  units: number
): { total: number; lines: TemplateQuoteLine[] } {
  const sorted = [...tiers].sort((a, b) => {
    if (a.upToUnits === null) return 1;
    if (b.upToUnits === null) return -1;
    return a.upToUnits - b.upToUnits;
  });

  const lines: TemplateQuoteLine[] = [];
  let remaining = Math.max(0, units);
  let lowerBound = 0;
  let total = 0;

  for (const tier of sorted) {
    if (remaining <= 0) break;
    const capacity = tier.upToUnits === null ? remaining : tier.upToUnits - lowerBound;
    const unitsInTier = Math.min(remaining, Math.max(0, capacity));
    const amount = unitsInTier * tier.unitPrice;

    lines.push({ tier, unitsInTier, amount });
    total += amount;
    remaining -= unitsInTier;
    if (tier.upToUnits !== null) lowerBound = tier.upToUnits;
  }

  return { total, lines };
}

/** Price a template for `units` of usage. */
export function quoteTemplate(template: PlanTemplate, units: number): TemplateQuote {
  const safeUnits = Math.max(0, units);

  if (template.pricingModel === 'flat' || template.tiers.length === 0) {
    return {
      templateId: template.id,
      units: safeUnits,
      total: template.basePrice,
      lines: [],
      effectiveUnitPrice: safeUnits === 0 ? 0 : template.basePrice / safeUnits,
    };
  }

  const { total, lines } = quoteTiers(template.tiers, safeUnits);
  return {
    templateId: template.id,
    units: safeUnits,
    total,
    lines,
    effectiveUnitPrice: safeUnits === 0 ? 0 : total / safeUnits,
  };
}

/** Resolve a template into concrete plan parameters, applying overrides. */
export function resolvePlan(
  template: PlanTemplate,
  overrides: TemplateOverrides = {}
): ResolvedPlan {
  const removed = new Set(overrides.removeFeatureKeys ?? []);
  const features: TemplateFeature[] = template.features.filter((f) => !removed.has(f.key));

  return {
    templateId: template.id,
    templateVersion: template.version,
    name: overrides.name ?? template.name,
    description: template.description,
    price: overrides.price ?? template.basePrice,
    currency: overrides.currency ?? template.currency,
    billingCycle: overrides.billingCycle ?? template.billingCycle,
    category: overrides.category ?? template.category,
    features,
  };
}

/** A template may be instantiated by its owner, or by anyone once shared. */
export function canInstantiate(template: PlanTemplate, callerId: string): boolean {
  return template.active && (template.shared || template.ownerId === callerId);
}

export function matchesFilter(template: PlanTemplate, filter: TemplateFilter): boolean {
  if (!filter.includeInactive && !template.active) return false;
  if (filter.sharedOnly && !template.shared) return false;
  if (filter.ownerId && template.ownerId !== filter.ownerId) return false;
  if (filter.category && template.category !== filter.category) return false;
  if (filter.billingCycle && template.billingCycle !== filter.billingCycle) return false;
  if (filter.pricingModel && template.pricingModel !== filter.pricingModel) return false;
  if (filter.tags?.length && !filter.tags.every((tag) => template.tags.includes(tag))) {
    return false;
  }
  if (filter.search) {
    const needle = filter.search.toLowerCase();
    const haystack = `${template.name} ${template.description} ${template.tags.join(' ')}`;
    if (!haystack.toLowerCase().includes(needle)) return false;
  }
  return true;
}

/**
 * Roll analytics up across a filtered slice of a template library.
 *
 * Pure, so a component can compute it from the state it already subscribes to
 * rather than reaching back into the store.
 */
export function computeLibraryAnalytics(
  templates: PlanTemplate[],
  analytics: Record<string, TemplateAnalytics>,
  filter: TemplateFilter = {}
): TemplateLibraryAnalytics {
  const scoped = templates
    .filter((template) => matchesFilter(template, { includeInactive: true, ...filter }))
    .map((template) => ({
      template,
      analytics: analytics[template.id] ?? emptyTemplateAnalytics(template.id),
    }));

  const roll = scoped.reduce(
    (acc, entry) => {
      acc.templates += 1;
      if (entry.template.shared) acc.sharedTemplates += 1;
      acc.totalViews += entry.analytics.views;
      acc.totalPlansCreated += entry.analytics.plansCreated;
      acc.totalSubscriptionsStarted += entry.analytics.subscriptionsStarted;
      acc.totalRevenue += entry.analytics.revenue;
      return acc;
    },
    {
      templates: 0,
      sharedTemplates: 0,
      totalViews: 0,
      totalPlansCreated: 0,
      totalSubscriptionsStarted: 0,
      totalRevenue: 0,
    }
  );

  return {
    ...roll,
    adoptionRate: ratio(roll.totalPlansCreated, roll.totalViews),
    conversionRate: ratio(roll.totalSubscriptionsStarted, roll.totalPlansCreated),
    topTemplateIds: scoped
      .filter((entry) => entry.analytics.subscriptionsStarted > 0)
      .sort((a, b) => b.analytics.subscriptionsStarted - a.analytics.subscriptionsStarted)
      .map((entry) => entry.template.id),
  };
}

/**
 * Starter templates seeded into an empty library so a new merchant has
 * something to instantiate on day one.
 */
export const STARTER_TEMPLATES: PlanTemplateDraft[] = [
  {
    name: 'Starter',
    description: 'Entry tier for individuals evaluating the product.',
    category: SubscriptionCategory.SOFTWARE,
    billingCycle: BillingCycle.MONTHLY,
    currency: 'USD',
    basePrice: 9,
    pricingModel: 'flat',
    tiers: [],
    features: [
      { key: 'seats', label: 'Seats', includedUnits: 1 },
      { key: 'support', label: 'Email support', includedUnits: null },
    ],
    tags: ['starter', 'saas'],
  },
  {
    name: 'Team',
    description: 'Collaboration tier with pooled seats and priority support.',
    category: SubscriptionCategory.SOFTWARE,
    billingCycle: BillingCycle.MONTHLY,
    currency: 'USD',
    basePrice: 49,
    pricingModel: 'flat',
    tiers: [],
    features: [
      { key: 'seats', label: 'Seats', includedUnits: 10, highlight: true },
      { key: 'support', label: 'Priority support', includedUnits: null },
      { key: 'sso', label: 'SSO', includedUnits: null },
    ],
    tags: ['team', 'saas'],
  },
  {
    name: 'Usage-based API',
    description: 'Metered plan: the first 1,000 calls are free, then graduated pricing.',
    category: SubscriptionCategory.SOFTWARE,
    billingCycle: BillingCycle.MONTHLY,
    currency: 'USD',
    basePrice: 1,
    pricingModel: 'tiered',
    tiers: [
      { upToUnits: 1_000, unitPrice: 0 },
      { upToUnits: 10_000, unitPrice: 0.01 },
      { upToUnits: null, unitPrice: 0.005 },
    ],
    features: [
      { key: 'api_calls', label: 'API calls', includedUnits: 1_000, highlight: true },
      { key: 'rate_limit', label: 'Rate limit', includedUnits: 100 },
    ],
    tags: ['usage', 'api'],
  },
];

// ── Store ────────────────────────────────────────────────────────────

interface PlanTemplateState {
  templates: PlanTemplate[];
  analytics: Record<string, TemplateAnalytics>;
  filter: TemplateFilter;
  error: string | null;

  // Library
  createTemplate: (ownerId: string, draft: PlanTemplateDraft) => PlanTemplate;
  getTemplate: (id: string) => PlanTemplate | undefined;
  listTemplates: (filter?: TemplateFilter) => PlanTemplate[];
  listAvailableTemplates: (callerId: string) => PlanTemplate[];
  setFilter: (patch: Partial<TemplateFilter>) => void;
  clearFilter: () => void;
  seedStarterTemplates: (ownerId: string) => PlanTemplate[];

  // Versioning
  publishVersion: (ownerId: string, templateId: string, draft: PlanTemplateDraft) => PlanTemplate;
  listVersions: (rootId: string) => PlanTemplate[];
  getLatestVersion: (rootId: string) => PlanTemplate | undefined;

  // Sharing
  setShared: (ownerId: string, templateId: string, shared: boolean) => void;

  // Instantiation
  instantiate: (
    callerId: string,
    templateId: string,
    overrides?: TemplateOverrides
  ) => ResolvedPlan;
  quote: (templateId: string, units: number) => TemplateQuote | null;

  // Analytics
  getAnalytics: (templateId: string) => TemplateAnalytics;
  recordView: (templateId: string) => void;
  recordSubscription: (templateId: string, revenue?: number) => void;
  getLibraryAnalytics: (filter?: TemplateFilter) => TemplateLibraryAnalytics;

  reset: () => void;
}

export const usePlanTemplateStore = create<PlanTemplateState>()(
  persist(
    (set, get) => {
      const mutateAnalytics = (
        templateId: string,
        patch: (analytics: TemplateAnalytics) => TemplateAnalytics
      ) => {
        set((state) => {
          const current = state.analytics[templateId] ?? emptyTemplateAnalytics(templateId);
          return {
            analytics: {
              ...state.analytics,
              [templateId]: withDerivedRates(patch(current)),
            },
          };
        });
      };

      const requireTemplate = (templateId: string): PlanTemplate => {
        const template = get().templates.find((t) => t.id === templateId);
        if (!template) throw new Error(`Plan template ${templateId} not found.`);
        return template;
      };

      return {
        templates: [],
        analytics: {},
        filter: {},
        error: null,

        // ── Library ──────────────────────────────────────────────

        createTemplate: (ownerId, draft) => {
          const validation = validateTemplateDraft(draft);
          if (!validation.valid) {
            const message = `Invalid plan template: ${validation.errors.join('; ')}`;
            set({ error: message });
            throw new Error(message);
          }

          const id = generateId();
          const timestamp = new Date().toISOString();
          const template: PlanTemplate = {
            ...draft,
            id,
            rootId: id,
            version: 1,
            ownerId,
            shared: false,
            active: true,
            createdAt: timestamp,
            updatedAt: timestamp,
          };

          set((state) => ({
            templates: [...state.templates, template],
            analytics: { ...state.analytics, [id]: emptyTemplateAnalytics(id) },
            error: null,
          }));

          return template;
        },

        getTemplate: (id) => get().templates.find((t) => t.id === id),

        listTemplates: (filter) => {
          const active = filter ?? get().filter;
          return get()
            .templates.filter((template) => matchesFilter(template, active))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        },

        listAvailableTemplates: (callerId) =>
          get()
            .templates.filter((template) => canInstantiate(template, callerId))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),

        setFilter: (patch) => set((state) => ({ filter: { ...state.filter, ...patch } })),

        clearFilter: () => set({ filter: {} }),

        seedStarterTemplates: (ownerId) => {
          if (get().templates.length > 0) return [];
          return STARTER_TEMPLATES.map((draft) => get().createTemplate(ownerId, draft));
        },

        // ── Versioning ───────────────────────────────────────────

        publishVersion: (ownerId, templateId, draft) => {
          const previous = requireTemplate(templateId);
          if (previous.ownerId !== ownerId) {
            const message = `Only the owner of template ${templateId} may publish a new version.`;
            set({ error: message });
            throw new Error(message);
          }

          const validation = validateTemplateDraft(draft);
          if (!validation.valid) {
            const message = `Invalid plan template: ${validation.errors.join('; ')}`;
            set({ error: message });
            throw new Error(message);
          }

          const id = generateId();
          const timestamp = new Date().toISOString();
          const next: PlanTemplate = {
            ...draft,
            id,
            rootId: previous.rootId,
            version: previous.version + 1,
            ownerId: previous.ownerId,
            // Sharing carries across versions, so a shared template stays in
            // the library at its newest version.
            shared: previous.shared,
            active: true,
            createdAt: timestamp,
            updatedAt: timestamp,
          };

          set((state) => ({
            templates: [
              // The superseded version stays readable but leaves the library.
              ...state.templates.map((t) =>
                t.id === templateId
                  ? { ...t, active: false, shared: false, updatedAt: timestamp }
                  : t
              ),
              next,
            ],
            analytics: { ...state.analytics, [id]: emptyTemplateAnalytics(id) },
            error: null,
          }));

          return next;
        },

        listVersions: (rootId) =>
          get()
            .templates.filter((t) => t.rootId === rootId)
            .sort((a, b) => a.version - b.version),

        getLatestVersion: (rootId) => {
          const versions = get().listVersions(rootId);
          return versions[versions.length - 1];
        },

        // ── Sharing ──────────────────────────────────────────────

        setShared: (ownerId, templateId, shared) => {
          const template = requireTemplate(templateId);
          if (template.ownerId !== ownerId) {
            const message = `Only the owner of template ${templateId} may share it.`;
            set({ error: message });
            throw new Error(message);
          }
          if (shared && !template.active) {
            const message = `Template ${templateId} is superseded and cannot be shared.`;
            set({ error: message });
            throw new Error(message);
          }

          const timestamp = new Date().toISOString();
          set((state) => ({
            templates: state.templates.map((t) =>
              t.id === templateId ? { ...t, shared, updatedAt: timestamp } : t
            ),
            error: null,
          }));
        },

        // ── Instantiation ────────────────────────────────────────

        instantiate: (callerId, templateId, overrides = {}) => {
          const template = requireTemplate(templateId);
          if (!canInstantiate(template, callerId)) {
            const message = template.active
              ? `Template ${templateId} is not shared with you.`
              : `Template ${templateId} is superseded; use its latest version.`;
            set({ error: message });
            throw new Error(message);
          }

          const resolved = resolvePlan(template, overrides);
          if (resolved.price <= 0) {
            const message = 'Resolved plan price must be positive.';
            set({ error: message });
            throw new Error(message);
          }

          mutateAnalytics(templateId, (analytics) => ({
            ...analytics,
            plansCreated: analytics.plansCreated + 1,
            lastUsedAt: new Date().toISOString(),
          }));

          return resolved;
        },

        quote: (templateId, units) => {
          const template = get().templates.find((t) => t.id === templateId);
          return template ? quoteTemplate(template, units) : null;
        },

        // ── Analytics ────────────────────────────────────────────

        getAnalytics: (templateId) =>
          get().analytics[templateId] ?? emptyTemplateAnalytics(templateId),

        recordView: (templateId) => {
          mutateAnalytics(templateId, (analytics) => ({
            ...analytics,
            views: analytics.views + 1,
          }));
        },

        recordSubscription: (templateId, revenue = 0) => {
          mutateAnalytics(templateId, (analytics) => ({
            ...analytics,
            subscriptionsStarted: analytics.subscriptionsStarted + 1,
            revenue: analytics.revenue + Math.max(0, revenue),
            lastUsedAt: new Date().toISOString(),
          }));
        },

        getLibraryAnalytics: (filter = {}) =>
          computeLibraryAnalytics(get().templates, get().analytics, filter),

        reset: () => set({ templates: [], analytics: {}, filter: {}, error: null }),
      };
    },
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => debouncedAsyncStorageAdapter),
      partialize: (state) => ({
        templates: state.templates,
        analytics: state.analytics,
      }),
    }
  )
);
