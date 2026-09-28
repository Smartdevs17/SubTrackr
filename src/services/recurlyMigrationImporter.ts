/**
 * recurlyMigrationImporter.ts
 *
 * Imports and migrates Recurly subscription data into SubTrackr's internal
 * format. Supports batch processing with a detailed MigrationReport output.
 */

import type {
  RecurlySubscription,
  RecurlyPlan,
  RecurlyIntervalUnit,
  RecurlySubscriptionState,
  ImportedSubscription,
  MigrationReport,
  RecurlyImporterOptions,
} from '../types/recurly';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const createId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function centsToMajor(cents: number): number {
  return parseFloat((cents / 100).toFixed(2));
}

function toBillingCycle(
  length: number,
  unit: RecurlyIntervalUnit
): { billingCycle: 'monthly' | 'yearly' | 'weekly' | 'custom'; customCycleDays?: number } {
  if (unit === 'months') {
    if (length === 1) return { billingCycle: 'monthly' };
    if (length === 12) return { billingCycle: 'yearly' };
    return { billingCycle: 'custom', customCycleDays: length * 30 };
  }
  if (unit === 'days') {
    if (length === 7) return { billingCycle: 'weekly' };
    if (length === 30) return { billingCycle: 'monthly' };
    if (length === 365) return { billingCycle: 'yearly' };
    return { billingCycle: 'custom', customCycleDays: length };
  }
  return { billingCycle: 'custom', customCycleDays: length };
}

function toTrialDays(
  length: number | undefined,
  unit: RecurlyIntervalUnit | undefined
): number | undefined {
  if (!length || !unit) return undefined;
  return unit === 'months' ? length * 30 : length;
}

function parseDate(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? undefined : d;
}

function isActiveState(state: RecurlySubscriptionState): boolean {
  return state === 'active' || state === 'future';
}

function isPausedState(state: RecurlySubscriptionState): boolean {
  return state === 'paused';
}

// ─── RecurlyMigrationImporter ─────────────────────────────────────────────────

export class RecurlyMigrationImporter {
  private options: Required<RecurlyImporterOptions>;

  constructor(options: RecurlyImporterOptions = {}) {
    this.options = {
      skipStates: options.skipStates ?? ['expired', 'failed'],
      defaultCurrency: options.defaultCurrency ?? 'USD',
      plansRegistry: options.plansRegistry ?? new Map(),
      batchSize: options.batchSize ?? 50,
    };
  }

  // ─── Single subscription ──────────────────────────────────────────────────

  /**
   * Convert a single Recurly subscription to SubTrackr ImportedSubscription.
   * Throws if the subscription cannot be mapped.
   */
  importSubscription(sub: RecurlySubscription): ImportedSubscription {
    const plan = sub.plan;
    const { billingCycle, customCycleDays } = toBillingCycle(
      plan.plan_interval_length,
      plan.plan_interval_unit
    );

    // Resolve full plan details from registry for trial info
    const fullPlan = this.options.plansRegistry.get(plan.code);
    const trialDays = toTrialDays(
      fullPlan?.trial_interval_length,
      fullPlan?.trial_interval_unit
    );

    const price = centsToMajor(sub.unit_amount_in_cents * (sub.quantity || 1));
    const currency = sub.currency || this.options.defaultCurrency;
    const nextBillingDate = parseDate(sub.current_period_ends_at);
    const createdAt = parseDate(sub.created_at) ?? new Date();
    const updatedAt = parseDate(sub.updated_at) ?? new Date();

    const addons = (sub.add_ons ?? []).map((a) => ({
      code: a.add_on_code,
      name: a.name,
      price: centsToMajor(a.unit_amount_in_cents * (a.quantity ?? 1)),
      quantity: a.quantity ?? 1,
    }));

    const imported: ImportedSubscription = {
      id: createId('rsub'),
      recurlyUuid: sub.uuid,
      accountCode: sub.account.account_code,
      name: plan.name,
      description: fullPlan?.description ?? '',
      price,
      currency,
      billingCycle,
      isActive: isActiveState(sub.state),
      isPaused: isPausedState(sub.state),
      isCryptoEnabled: false,
      addons,
      createdAt,
      updatedAt,
    };

    if (customCycleDays !== undefined) imported.customCycleDays = customCycleDays;
    if (trialDays !== undefined) imported.trialDays = trialDays;
    if (nextBillingDate !== undefined) imported.nextBillingDate = nextBillingDate;

    return imported;
  }

  // ─── Batch import ─────────────────────────────────────────────────────────

  /**
   * Import a batch of Recurly subscriptions and produce a MigrationReport.
   */
  async importBatch(subscriptions: RecurlySubscription[]): Promise<MigrationReport> {
    const startedAt = new Date();
    const importedSubs: ImportedSubscription[] = [];
    const errors: MigrationReport['errors'] = [];
    const skippedIds: string[] = [];

    const { batchSize, skipStates } = this.options;

    for (let i = 0; i < subscriptions.length; i += batchSize) {
      const batch = subscriptions.slice(i, i + batchSize);

      for (const sub of batch) {
        // Skip states
        if (skipStates.includes(sub.state)) {
          skippedIds.push(sub.uuid);
          continue;
        }

        try {
          const imported = this.importSubscription(sub);
          importedSubs.push(imported);
        } catch (err) {
          errors.push({
            recurlyUuid: sub.uuid,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Yield to event loop between batches to avoid blocking UI thread
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    }

    const completedAt = new Date();

    return {
      total: subscriptions.length,
      succeeded: importedSubs.length,
      failed: errors.length,
      skipped: skippedIds.length,
      subscriptions: importedSubs,
      errors,
      skippedIds,
      startedAt,
      completedAt,
    };
  }

  /**
   * Import subscriptions synchronously (no batching delay). Useful for small
   * datasets or testing scenarios.
   */
  importAll(subscriptions: RecurlySubscription[]): Omit<MigrationReport, 'startedAt' | 'completedAt'> {
    const importedSubs: ImportedSubscription[] = [];
    const errors: MigrationReport['errors'] = [];
    const skippedIds: string[] = [];
    const { skipStates } = this.options;

    for (const sub of subscriptions) {
      if (skipStates.includes(sub.state)) {
        skippedIds.push(sub.uuid);
        continue;
      }
      try {
        importedSubs.push(this.importSubscription(sub));
      } catch (err) {
        errors.push({
          recurlyUuid: sub.uuid,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      total: subscriptions.length,
      succeeded: importedSubs.length,
      failed: errors.length,
      skipped: skippedIds.length,
      subscriptions: importedSubs,
      errors,
      skippedIds,
    };
  }

  // ─── Plan registry helpers ─────────────────────────────────────────────────

  registerPlan(plan: RecurlyPlan): void {
    this.options.plansRegistry.set(plan.code, plan);
  }

  registerPlans(plans: RecurlyPlan[]): void {
    for (const p of plans) this.registerPlan(p);
  }

  getRegisteredPlan(code: string): RecurlyPlan | undefined {
    return this.options.plansRegistry.get(code);
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createRecurlyMigrationImporter(
  options?: RecurlyImporterOptions
): RecurlyMigrationImporter {
  return new RecurlyMigrationImporter(options);
}
