/**
 * Plan template library.
 *
 * Merchants build plans from reusable blueprints instead of from scratch. A
 * template carries a base price, an optional graduated pricing ladder, and a
 * feature list. Instantiating a template resolves it into concrete plan
 * parameters, optionally customized, without ever mutating the template.
 *
 * Templates are immutable once published: an edit publishes a new version
 * chained to the same root, so plans already created from an earlier version
 * stay explainable. Sharing publishes a template to a library other merchants
 * may instantiate but never edit.
 *
 * Mirrors the `plan_templates` module of the subscription contract.
 */

import { BillingError, BillingErrorCode } from './errors';
import { TieredPricingCalculator } from './tieredPricingCalculator';
import type {
  PlanTemplate,
  PlanTemplateDraft,
  ResolvedPlan,
  TemplateAnalytics,
  TemplateFeature,
  TemplateFilter,
  TemplateLibraryAnalytics,
  TemplateOverrides,
  TemplateQuote,
  TemplateValidationResult,
} from '../../../src/types/planTemplate';
import type { PricingTier } from '../../../src/types/usage';

/** Ceiling on tiers in one template, bounding the cost of a price quote. */
export const MAX_TIERS = 12;

/** Ceiling on features listed by one template. */
export const MAX_FEATURES = 32;

/** Storage abstraction — implemented by the persistence layer. */
export interface PlanTemplateRepository {
  save(template: PlanTemplate): Promise<void>;
  get(id: string): Promise<PlanTemplate | null>;
  list(): Promise<PlanTemplate[]>;
  saveAnalytics(analytics: TemplateAnalytics): Promise<void>;
  getAnalytics(templateId: string): Promise<TemplateAnalytics | null>;
}

/** In-memory repository, used by tests and the local development server. */
export class InMemoryPlanTemplateRepository implements PlanTemplateRepository {
  private templates = new Map<string, PlanTemplate>();
  private analytics = new Map<string, TemplateAnalytics>();

  async save(template: PlanTemplate): Promise<void> {
    this.templates.set(template.id, { ...template });
  }

  async get(id: string): Promise<PlanTemplate | null> {
    const found = this.templates.get(id);
    return found ? { ...found } : null;
  }

  async list(): Promise<PlanTemplate[]> {
    return [...this.templates.values()].map((t) => ({ ...t }));
  }

  async saveAnalytics(analytics: TemplateAnalytics): Promise<void> {
    this.analytics.set(analytics.templateId, { ...analytics });
  }

  async getAnalytics(templateId: string): Promise<TemplateAnalytics | null> {
    const found = this.analytics.get(templateId);
    return found ? { ...found } : null;
  }
}

export function emptyTemplateAnalytics(templateId: string): TemplateAnalytics {
  return {
    templateId,
    views: 0,
    plansCreated: 0,
    subscriptionsStarted: 0,
    revenue: 0,
    adoptionRate: 0,
    conversionRate: 0,
    averageRevenuePerSubscription: 0,
    lastUsedAt: null,
  };
}

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : Math.min(1, numerator / denominator);

function withDerivedRates(analytics: TemplateAnalytics): TemplateAnalytics {
  return {
    ...analytics,
    adoptionRate: ratio(analytics.plansCreated, analytics.views),
    conversionRate: ratio(analytics.subscriptionsStarted, analytics.plansCreated),
    averageRevenuePerSubscription:
      analytics.subscriptionsStarted === 0
        ? 0
        : analytics.revenue / analytics.subscriptionsStarted,
  };
}

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

/** Validate a draft before it is published. */
export function validateTemplateDraft(draft: PlanTemplateDraft): TemplateValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!draft.name?.trim()) errors.push('Template name is required.');
  if (draft.basePrice <= 0) errors.push('Base price must be positive.');
  if (!draft.currency?.trim()) errors.push('Currency is required.');
  if (draft.features.length > MAX_FEATURES) {
    errors.push(`A template supports at most ${MAX_FEATURES} features.`);
  }

  const featureKeys = new Set<string>();
  for (const feature of draft.features) {
    if (featureKeys.has(feature.key)) {
      errors.push(`Duplicate feature key "${feature.key}".`);
    }
    featureKeys.add(feature.key);
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

/** Price a template for `units` of usage, with the per-tier breakdown. */
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

  const { totalAmount, lines } = new TieredPricingCalculator(template.tiers).calculate(safeUnits);
  return {
    templateId: template.id,
    units: safeUnits,
    total: totalAmount,
    lines,
    effectiveUnitPrice: safeUnits === 0 ? 0 : totalAmount / safeUnits,
  };
}

/** A template may be instantiated by its owner, or by anyone once shared. */
export function canInstantiate(template: PlanTemplate, callerId: string): boolean {
  return template.active && (template.shared || template.ownerId === callerId);
}

function matchesFilter(template: PlanTemplate, filter: TemplateFilter): boolean {
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

export class PlanTemplateService {
  private sequence = 0;

  constructor(
    private readonly repo: PlanTemplateRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  private nextId(): string {
    this.sequence += 1;
    return `tpl_${this.sequence.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // ── Library ────────────────────────────────────────────────────────

  /** Publish the first version of a template. */
  async createTemplate(ownerId: string, draft: PlanTemplateDraft): Promise<PlanTemplate> {
    const validation = validateTemplateDraft(draft);
    if (!validation.valid) {
      throw new BillingError(
        BillingErrorCode.INVALID_PLAN,
        `Invalid plan template: ${validation.errors.join('; ')}`,
        { ownerId }
      );
    }

    const id = this.nextId();
    const timestamp = this.now().toISOString();
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

    await this.repo.save(template);
    await this.repo.saveAnalytics(emptyTemplateAnalytics(id));
    return template;
  }

  async getTemplate(id: string): Promise<PlanTemplate | null> {
    return this.repo.get(id);
  }

  /** Browse the library. Superseded versions are hidden unless asked for. */
  async listTemplates(filter: TemplateFilter = {}): Promise<PlanTemplate[]> {
    const templates = await this.repo.list();
    return templates
      .filter((template) => matchesFilter(template, filter))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Templates a caller may instantiate: their own, plus everything shared.
   */
  async listAvailableTemplates(callerId: string): Promise<PlanTemplate[]> {
    const templates = await this.repo.list();
    return templates
      .filter((template) => canInstantiate(template, callerId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  // ── Versioning ─────────────────────────────────────────────────────

  /**
   * Publish a new version, superseding `templateId`.
   *
   * The previous version is deactivated but kept readable, and leaves the
   * shared library so it can no longer be browsed or instantiated. Analytics
   * start fresh, since they measure a single version's performance.
   */
  async publishVersion(
    ownerId: string,
    templateId: string,
    draft: PlanTemplateDraft
  ): Promise<PlanTemplate> {
    const previous = await this.requireTemplate(templateId);
    this.requireOwner(previous, ownerId, 'publish a new version of');

    const validation = validateTemplateDraft(draft);
    if (!validation.valid) {
      throw new BillingError(
        BillingErrorCode.INVALID_PLAN,
        `Invalid plan template: ${validation.errors.join('; ')}`,
        { templateId }
      );
    }

    const wasShared = previous.shared;
    const timestamp = this.now().toISOString();
    const id = this.nextId();

    const next: PlanTemplate = {
      ...draft,
      id,
      rootId: previous.rootId,
      version: previous.version + 1,
      ownerId: previous.ownerId,
      // Sharing carries across versions, so a shared template stays in the
      // library at its newest version.
      shared: wasShared,
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.repo.save({ ...previous, active: false, shared: false, updatedAt: timestamp });
    await this.repo.save(next);
    await this.repo.saveAnalytics(emptyTemplateAnalytics(id));
    return next;
  }

  /** Every version of a template chain, oldest first. */
  async listVersions(rootId: string): Promise<PlanTemplate[]> {
    const templates = await this.repo.list();
    return templates
      .filter((template) => template.rootId === rootId)
      .sort((a, b) => a.version - b.version);
  }

  async getLatestVersion(rootId: string): Promise<PlanTemplate | null> {
    const versions = await this.listVersions(rootId);
    return versions.length === 0 ? null : versions[versions.length - 1];
  }

  // ── Sharing ────────────────────────────────────────────────────────

  /** Publish a template to, or withdraw it from, the shared library. */
  async setShared(ownerId: string, templateId: string, shared: boolean): Promise<PlanTemplate> {
    const template = await this.requireTemplate(templateId);
    this.requireOwner(template, ownerId, 'share');

    if (!template.active && shared) {
      throw new BillingError(
        BillingErrorCode.INVALID_PLAN,
        `Template ${templateId} is superseded and cannot be shared.`,
        { templateId }
      );
    }

    const updated = { ...template, shared, updatedAt: this.now().toISOString() };
    await this.repo.save(updated);
    return updated;
  }

  // ── Instantiation ──────────────────────────────────────────────────

  /**
   * Resolve a template into plan parameters and record the usage.
   *
   * The template itself is never mutated by an instantiation.
   */
  async instantiate(
    callerId: string,
    templateId: string,
    overrides: TemplateOverrides = {}
  ): Promise<ResolvedPlan> {
    const template = await this.requireTemplate(templateId);

    if (!canInstantiate(template, callerId)) {
      throw new BillingError(
        BillingErrorCode.INVALID_PLAN,
        template.active
          ? `Template ${templateId} is not shared with ${callerId}.`
          : `Template ${templateId} is superseded; use its latest version.`,
        { templateId, callerId }
      );
    }

    const resolved = resolvePlan(template, overrides);
    if (resolved.price <= 0) {
      throw new BillingError(
        BillingErrorCode.INVALID_PLAN,
        'Resolved plan price must be positive.',
        { templateId }
      );
    }

    await this.recordPlanCreated(templateId);
    return resolved;
  }

  /** Price a template for `units` of usage. */
  async quote(templateId: string, units: number): Promise<TemplateQuote> {
    const template = await this.requireTemplate(templateId);
    return quoteTemplate(template, units);
  }

  // ── Analytics ──────────────────────────────────────────────────────

  async getAnalytics(templateId: string): Promise<TemplateAnalytics> {
    const stored = await this.repo.getAnalytics(templateId);
    return stored ?? emptyTemplateAnalytics(templateId);
  }

  /** Record that the template was previewed in the library. */
  async recordView(templateId: string): Promise<TemplateAnalytics> {
    return this.mutateAnalytics(templateId, (analytics) => ({
      ...analytics,
      views: analytics.views + 1,
    }));
  }

  /** Record that a plan was instantiated from the template. */
  async recordPlanCreated(templateId: string): Promise<TemplateAnalytics> {
    return this.mutateAnalytics(templateId, (analytics) => ({
      ...analytics,
      plansCreated: analytics.plansCreated + 1,
      lastUsedAt: this.now().toISOString(),
    }));
  }

  /** Record that a plan created from the template gained a subscriber. */
  async recordSubscription(templateId: string, revenue = 0): Promise<TemplateAnalytics> {
    return this.mutateAnalytics(templateId, (analytics) => ({
      ...analytics,
      subscriptionsStarted: analytics.subscriptionsStarted + 1,
      revenue: analytics.revenue + Math.max(0, revenue),
      lastUsedAt: this.now().toISOString(),
    }));
  }

  /** Roll up analytics across a filtered slice of the library. */
  async getLibraryAnalytics(filter: TemplateFilter = {}): Promise<TemplateLibraryAnalytics> {
    const templates = await this.listTemplates({ includeInactive: true, ...filter });
    const perTemplate = await Promise.all(
      templates.map(async (template) => ({
        template,
        analytics: await this.getAnalytics(template.id),
      }))
    );

    const roll = perTemplate.reduce(
      (acc, { template, analytics }) => {
        acc.templates += 1;
        if (template.shared) acc.sharedTemplates += 1;
        acc.totalViews += analytics.views;
        acc.totalPlansCreated += analytics.plansCreated;
        acc.totalSubscriptionsStarted += analytics.subscriptionsStarted;
        acc.totalRevenue += analytics.revenue;
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

    const topTemplateIds = perTemplate
      .filter(({ analytics }) => analytics.subscriptionsStarted > 0)
      .sort((a, b) => b.analytics.subscriptionsStarted - a.analytics.subscriptionsStarted)
      .map(({ template }) => template.id);

    return {
      ...roll,
      adoptionRate: ratio(roll.totalPlansCreated, roll.totalViews),
      conversionRate: ratio(roll.totalSubscriptionsStarted, roll.totalPlansCreated),
      topTemplateIds,
    };
  }

  // ── Internals ──────────────────────────────────────────────────────

  private async mutateAnalytics(
    templateId: string,
    patch: (analytics: TemplateAnalytics) => TemplateAnalytics
  ): Promise<TemplateAnalytics> {
    const next = withDerivedRates(patch(await this.getAnalytics(templateId)));
    await this.repo.saveAnalytics(next);
    return next;
  }

  private async requireTemplate(templateId: string): Promise<PlanTemplate> {
    const template = await this.repo.get(templateId);
    if (!template) {
      throw new BillingError(
        BillingErrorCode.INVALID_PLAN,
        `Plan template ${templateId} not found.`,
        { templateId }
      );
    }
    return template;
  }

  private requireOwner(template: PlanTemplate, callerId: string, action: string): void {
    if (template.ownerId !== callerId) {
      throw new BillingError(
        BillingErrorCode.INVALID_PLAN,
        `Only the owner of template ${template.id} may ${action} it.`,
        { templateId: template.id, callerId }
      );
    }
  }
}
