import { StrategyRegistry } from './StrategyRegistry';
import { FlatPricingStrategy } from './strategies/FlatPricingStrategy';
import { PerSeatPricingStrategy } from './strategies/PerSeatPricingStrategy';
import { TieredPricingStrategy } from './strategies/TieredPricingStrategy';
import { UsageBasedPricingStrategy } from './strategies/UsageBasedPricingStrategy';
import type { Amount, BillingPlan, BillingSubscriber, BillingUsage } from './types';

const resolvePlanTypeCode = (plan: BillingPlan): string =>
  plan.typeCode ??
  (plan as BillingPlan & { planTypeCode?: string }).planTypeCode ??
  (plan as BillingPlan & { type?: string }).type ??
  (plan as BillingPlan & { code?: string }).code ??
  'fallback';

export class BillingEngine {
  private readonly registry: StrategyRegistry;

  constructor(registry: StrategyRegistry = BillingEngine.defaultRegistry()) {
    this.registry = registry;
  }

  static defaultRegistry(): StrategyRegistry {
    return new StrategyRegistry([
      new FlatPricingStrategy(),
      new PerSeatPricingStrategy(),
      new UsageBasedPricingStrategy(),
      new TieredPricingStrategy(),
    ]);
  }

  calculate(usage: BillingUsage, plan: BillingPlan, subscriber: BillingSubscriber): Amount {
    return this.registry.resolve(resolvePlanTypeCode(plan)).calculate(usage, plan, subscriber);
  }

  calculateInvoiceAmount(usage: BillingUsage, plan: BillingPlan, subscriber: BillingSubscriber): Amount {
    return this.calculate(usage, plan, subscriber);
  }

  calculateInvoice(usage: BillingUsage, plan: BillingPlan, subscriber: BillingSubscriber): Amount {
    return this.calculate(usage, plan, subscriber);
  }
}
