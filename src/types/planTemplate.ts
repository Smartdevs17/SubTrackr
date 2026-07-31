/**
 * Plan templates — reusable blueprints merchants instantiate plans from.
 *
 * Mirrors the `plan_templates` module of the subscription contract, so the
 * client, the billing domain and the contract agree on the same shape.
 */

import type { PricingTier } from './usage';
import type { BillingCycle, SubscriptionCategory } from './subscription';

export type { PricingTier };

/** How a template prices a plan. */
export type TemplatePricingModel = 'flat' | 'tiered';

/** A feature advertised by a template, optionally quantified. */
export interface TemplateFeature {
  key: string;
  label: string;
  /** Included allowance, `null` for an unmetered feature. */
  includedUnits: number | null;
  /** Highlighted in comparison tables. */
  highlight?: boolean;
}

/**
 * A reusable plan blueprint.
 *
 * Templates are immutable once published: editing means publishing a new
 * version, which leaves plans already created from the old one untouched.
 */
export interface PlanTemplate {
  id: string;
  /** First version's id; equal to `id` for a first version. */
  rootId: string;
  version: number;
  ownerId: string;
  name: string;
  description: string;
  category: SubscriptionCategory;
  billingCycle: BillingCycle;
  currency: string;
  /** Flat price per interval; also the floor shown for tiered templates. */
  basePrice: number;
  pricingModel: TemplatePricingModel;
  /** Graduated ladder; empty for a flat template. */
  tiers: PricingTier[];
  features: TemplateFeature[];
  /** Published to the shared library for other merchants to instantiate. */
  shared: boolean;
  /** A superseded version stays readable but cannot be instantiated. */
  active: boolean;
  /** Free-form labels used to filter the library. */
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * The fields a merchant supplies when authoring a template. Ownership,
 * identity, version and lifecycle are assigned on publish.
 */
export type PlanTemplateDraft = Omit<
  PlanTemplate,
  'id' | 'rootId' | 'version' | 'ownerId' | 'shared' | 'active' | 'createdAt' | 'updatedAt'
>;

/** Per-instantiation customization. Omitted fields keep the template's value. */
export interface TemplateOverrides {
  name?: string;
  price?: number;
  currency?: string;
  billingCycle?: BillingCycle;
  category?: SubscriptionCategory;
  /** Feature keys to drop from the instantiated plan. */
  removeFeatureKeys?: string[];
}

/** The concrete plan parameters a template resolves to. */
export interface ResolvedPlan {
  templateId: string;
  templateVersion: number;
  name: string;
  description: string;
  price: number;
  currency: string;
  billingCycle: BillingCycle;
  category: SubscriptionCategory;
  features: TemplateFeature[];
}

/** One rung of a price quote against a tiered template. */
export interface TemplateQuoteLine {
  tier: PricingTier;
  unitsInTier: number;
  amount: number;
}

export interface TemplateQuote {
  templateId: string;
  units: number;
  total: number;
  lines: TemplateQuoteLine[];
  /** `total / units`, `0` for a zero-unit quote. */
  effectiveUnitPrice: number;
}

/** Usage and conversion counters for one template. */
export interface TemplateAnalytics {
  templateId: string;
  /** Times the template was previewed in the library. */
  views: number;
  /** Plans instantiated from the template. */
  plansCreated: number;
  /** Subscriptions started against those plans. */
  subscriptionsStarted: number;
  /** Revenue attributed to those subscriptions, in the template's currency. */
  revenue: number;
  /** `plansCreated / views`, 0-1. */
  adoptionRate: number;
  /** `subscriptionsStarted / plansCreated`, 0-1. */
  conversionRate: number;
  /** `revenue / subscriptionsStarted`. */
  averageRevenuePerSubscription: number;
  lastUsedAt: string | null;
}

/** Library-wide roll-up across every template a merchant owns. */
export interface TemplateLibraryAnalytics {
  templates: number;
  sharedTemplates: number;
  totalViews: number;
  totalPlansCreated: number;
  totalSubscriptionsStarted: number;
  totalRevenue: number;
  adoptionRate: number;
  conversionRate: number;
  /** Template ids ordered by subscriptions started, best first. */
  topTemplateIds: string[];
}

/** Filters applied when browsing the library. */
export interface TemplateFilter {
  ownerId?: string;
  category?: SubscriptionCategory;
  billingCycle?: BillingCycle;
  pricingModel?: TemplatePricingModel;
  tags?: string[];
  /** Restrict to templates published to the shared library. */
  sharedOnly?: boolean;
  /** Include superseded versions, which are hidden by default. */
  includeInactive?: boolean;
  search?: string;
}

export interface TemplateValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
