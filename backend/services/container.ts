/**
 * IoC Container — lightweight dependency injection with support for:
 *  - Singleton & transient lifetimes
 *  - Lazy factory bindings (resolved on first access)
 *  - Module-level bulk registration
 *  - Lifecycle hooks (init / dispose)
 *  - Circular dependency detection
 *  - Test isolation via clear()
 *
 * Module boundaries are enforced through token-based registration.
 * Modules depend on interfaces (I-prefixed tokens), never on concrete
 * classes from sibling modules. Cross-module coupling flows exclusively
 * through the container.
 */
import { subscriptionEventStore } from './subscription/subscriptionEventStore';
import { elasticsearchService } from './subscription/ElasticsearchService';
import { MeteringService } from './billing/meteringService';
import { PricingService } from './billing/pricingService';
import { TaxService } from './billing/taxService';
import { dunningService } from './billing/dunningService';
import { NotificationPreferenceService } from './notification/preferenceService';
import { AlertingService } from './notification/alerting';
import { webhookDeliveryService } from './notification/webhook';
import { webSocketServer } from './notification/websocket';
import { CampaignService } from './analytics/campaignService';
import { DataPipelineService } from './analytics/dataPipeline';
import { DataWarehouseService } from './analytics/dataWarehouse';
import { PredictionService } from './analytics/predictionService';
import { RecommendationService } from './analytics/recommendationService';
import { RetentionService } from './analytics/retentionService';
import { oracleMonitorService } from './analytics/oracleMonitorService';
import { getPlanCacheService } from '../subscription/planCacheRegistry';
import type { PlanCacheService } from '../subscription/domain/PlanCacheService';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Lifetime = 'singleton' | 'transient';

export interface Binding<T = unknown> {
  token: string | symbol;
  factory: (c: Container) => T;
  lifetime: Lifetime;
  instance?: T;
}

export interface ModuleRegistration {
  module: string;
  bindings: Array<{ token: string | symbol; factory: (c: Container) => unknown; lifetime?: Lifetime }>;
}

export interface Disposable {
  dispose(): void | Promise<void>;
}

// ─── Container ────────────────────────────────────────────────────────────────

export class Container {
  private bindings = new Map<string | symbol, Binding>();
  private resolving = new Set<string | symbol>(); // Circular dependency detection
  private disposed = false;

  /** Extract a token key from various forms. */
  private keyOf(token: string | symbol | { new (...args: any[]): unknown }): string | symbol {
    if (typeof token === 'string' || typeof token === 'symbol') return token;
    return token.name;
  }

  // ── Registration ──────────────────────────────────────────────────────────

  /** Register an already-created singleton instance (eager). */
  register<T>(token: string | symbol | { new (...args: any[]): T }, instance: T): void {
    this.ensureNotDisposed();
    const key = this.keyOf(token);
    this.bindings.set(key, {
      token: key,
      factory: () => instance,
      lifetime: 'singleton',
      instance,
    });
  }

  /** Register a lazy factory. The factory runs once for singletons, every time for transients. */
  bind<T>(
    token: string | symbol | { new (...args: any[]): T },
    factory: (c: Container) => T,
    lifetime: Lifetime = 'singleton'
  ): void {
    this.ensureNotDisposed();
    const key = this.keyOf(token);
    this.bindings.set(key, { token: key, factory, lifetime });
  }

  /** Convenience: bind a class constructor with transient lifetime (new instance each resolve). */
  bindTransient<T>(token: string | symbol | { new (...args: any[]): T }, factory: (c: Container) => T): void {
    this.bind(token, factory, 'transient');
  }

  /** Bulk-register a module's bindings. */
  registerModule(registration: ModuleRegistration): void {
    for (const { token, factory, lifetime } of registration.bindings) {
      this.bind(token, factory, lifetime ?? 'singleton');
    }
  }

  // ── Resolution ────────────────────────────────────────────────────────────

  /** Resolve a dependency. Throws if not registered. */
  resolve<T>(token: string | symbol | { new (...args: any[]): T }): T {
    this.ensureNotDisposed();
    const key = this.keyOf(token);
    const binding = this.bindings.get(key);

    if (!binding) {
      throw new Error(
        `[Container] Service not registered: ${String(key)}. ` +
        `Registered tokens: [${[...this.bindings.keys()].map(String).join(', ')}]`
      );
    }

    // Circular dependency guard
    if (this.resolving.has(key)) {
      throw new Error(
        `[Container] Circular dependency detected: ${String(key)} is already being resolved. ` +
        `Resolution chain: [${[...this.resolving].map(String).join(' -> ')}]`
      );
    }

    // Singleton already cached
    if (binding.lifetime === 'singleton' && binding.instance !== undefined) {
      return binding.instance as T;
    }

    this.resolving.add(key);
    try {
      const instance = binding.factory(this);
      if (binding.lifetime === 'singleton') {
        binding.instance = instance;
      }
      return instance;
    } finally {
      this.resolving.delete(key);
    }
  }

  /** Try to resolve, returning null instead of throwing. */
  tryResolve<T>(token: string | symbol | { new (...args: any[]): T }): T | null {
    try {
      return this.resolve(token);
    } catch {
      return null;
    }
  }

  /** Check if a token is registered. */
  has(token: string | symbol | { new (...args: any[]): unknown }): boolean {
    return this.bindings.has(this.keyOf(token));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Call dispose() on all registered Disposable singletons. */
  async disposeAll(): Promise<void> {
    this.disposed = true;
    for (const [, binding] of this.bindings) {
      if (binding.instance && typeof (binding.instance as Disposable).dispose === 'function') {
        await (binding.instance as Disposable).dispose();
      }
    }
    this.bindings.clear();
  }

  /** Reset all bindings (for test isolation). */
  clear(): void {
    this.disposed = false;
    this.bindings.clear();
    this.resolving.clear();
  }

  /** List all registered token keys (useful for debugging). */
  listTokens(): string[] {
    return [...this.bindings.keys()].map(String);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('[Container] Cannot register or resolve after disposeAll()');
    }
  }
}

export const container = new Container();

// ── Default Bindings ──────────────────────────────────────────────────────────

// ── Subscription ──────────────────────────────────────────────────────────────
container.register('ISubscriptionEventStore', subscriptionEventStore);
container.register('IElasticsearchService', elasticsearchService);

// ── Billing ───────────────────────────────────────────────────────────────────
container.bind('IMeteringService', () => new MeteringService());
container.bind('IPricingService', () => new PricingService());
container.bind('ITaxService', () => new TaxService());
container.register('IDunningService', dunningService);

// ── Notification ──────────────────────────────────────────────────────────────
container.bind('INotificationPreferenceService', () => new NotificationPreferenceService());
container.bind('IAlertingService', () => new AlertingService());
container.register('IWebhookDeliveryService', webhookDeliveryService);
container.register('IWebsocketService', webSocketServer);

// ── Analytics ─────────────────────────────────────────────────────────────────
container.bind('ICampaignService', () => new CampaignService());
container.bind('IDataPipelineService', () => new DataPipelineService());
container.bind('IDataWarehouseService', () => new DataWarehouseService());
container.bind('IPredictionService', () => new PredictionService());
container.bind('IRecommendationService', () => new RecommendationService());
container.bind('IRetentionService', () => new RetentionService());
container.register('IOracleMonitorService', oracleMonitorService);

// ── Plan cache (requires bootstrapPlanCache() at startup) ─────────────────────
container.bind('IPlanCacheService', () => {
  const svc = getPlanCacheService();
  if (!svc) {
    throw new Error(
      '[Container] IPlanCacheService not available. Call bootstrapPlanCache() during startup.',
    );
  }
  return svc as PlanCacheService;
});
