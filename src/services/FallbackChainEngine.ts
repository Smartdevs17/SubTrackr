/**
 * FallbackChainEngine
 *
 * An advanced strategy engine for executing payment method fallback chains.
 * Extends the basic sequential chain in PaymentMethodService with:
 *
 *   - WeightedStrategy     — probabilistic selection weighted by method health
 *   - StickyStrategy       — prefer the last-successful method per subscription
 *   - PriorityBurstStrategy — use primary methods in burst, then fall back
 *   - GeoAwareStrategy     — prefer methods matching the payment's chain region
 *   - RoundRobinStrategy   — distribute load evenly across primary methods
 *
 * The engine is strategy-agnostic: new strategies can be registered at runtime.
 */

import { PaymentMethod, PaymentAttempt, FallbackChain, PaymentPriority, TokenType } from '../types/wallet';
import {
  PaymentMethodService,
  PaymentMethodError,
  PaymentMethodErrorCode,
  ChainPaymentResult,
} from './paymentMethodService';

// ---------------------------------------------------------------------------
// Strategy interface
// ---------------------------------------------------------------------------

export interface ChainStrategyContext {
  subscriptionId: string;
  amount: string;
  chainId: number;
  maxGasPriceGwei: number;
  /** Historical attempts for this subscription (most recent first) */
  priorAttempts: PaymentAttempt[];
  /** All available methods (active + inactive) */
  allMethods: PaymentMethod[];
}

export interface ChainStrategyResult {
  /** Ordered list of methods to try, built by the strategy */
  orderedMethods: PaymentMethod[];
  /** Human-readable description of why the strategy produced this order */
  rationale: string;
  /** Strategy identifier */
  strategyId: string;
}

export interface ChainStrategy {
  readonly id: string;
  readonly name: string;
  /**
   * Given available methods and execution context, returns the order in which
   * they should be tried.
   */
  order(methods: PaymentMethod[], ctx: ChainStrategyContext): ChainStrategyResult;
}

// ---------------------------------------------------------------------------
// Built-in strategies
// ---------------------------------------------------------------------------

/** Ordered by PaymentPriority → lastUsedAt, same as PaymentMethodService default. */
export class PriorityStrategy implements ChainStrategy {
  readonly id = 'priority';
  readonly name = 'Priority';

  order(methods: PaymentMethod[], _ctx: ChainStrategyContext): ChainStrategyResult {
    const PRIORITY_ORDER: Record<PaymentPriority, number> = {
      [PaymentPriority.PRIMARY]: 0,
      [PaymentPriority.BACKUP]: 1,
      [PaymentPriority.FALLBACK]: 2,
    };

    const ordered = [...methods].sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      const aTime = a.lastUsedAt?.getTime() ?? a.createdAt.getTime();
      const bTime = b.lastUsedAt?.getTime() ?? b.createdAt.getTime();
      return bTime - aTime;
    });

    return {
      orderedMethods: ordered,
      rationale: 'Sorted by priority tier then most-recently-used.',
      strategyId: this.id,
    };
  }
}

/**
 * Probabilistic selection weighted by success rate.
 * Methods with higher success rates are sampled first.
 */
export class WeightedStrategy implements ChainStrategy {
  readonly id = 'weighted';
  readonly name = 'Weighted';

  order(methods: PaymentMethod[], ctx: ChainStrategyContext): ChainStrategyResult {
    const stats = this._computeStats(methods, ctx.priorAttempts);

    // Assign weights: successRate * 100 (floor at 5 so every method gets a chance)
    const weighted = methods.map((m) => ({
      method: m,
      weight: Math.max(5, Math.round((stats.get(m.id)?.successRate ?? 1) * 100)),
    }));

    const ordered: PaymentMethod[] = [];
    const pool = [...weighted];

    while (pool.length > 0) {
      const totalWeight = pool.reduce((sum, entry) => sum + entry.weight, 0);
      let rand = Math.random() * totalWeight;
      for (let i = 0; i < pool.length; i++) {
        rand -= pool[i].weight;
        if (rand <= 0) {
          ordered.push(pool[i].method);
          pool.splice(i, 1);
          break;
        }
      }
    }

    return {
      orderedMethods: ordered,
      rationale: `Weighted random ordering by success rate (${methods.length} methods).`,
      strategyId: this.id,
    };
  }

  private _computeStats(
    methods: PaymentMethod[],
    attempts: PaymentAttempt[]
  ): Map<string, { successRate: number }> {
    const map = new Map<string, { successRate: number }>();
    for (const method of methods) {
      const methodAttempts = attempts.filter((a) => a.paymentMethodId === method.id);
      const successes = methodAttempts.filter((a) => a.status === 'success').length;
      const rate = methodAttempts.length === 0 ? 1 : successes / methodAttempts.length;
      map.set(method.id, { successRate: rate });
    }
    return map;
  }
}

/**
 * Prefer the method that succeeded most recently for this subscription.
 * Falls back to priority ordering when no history exists.
 */
export class StickyStrategy implements ChainStrategy {
  readonly id = 'sticky';
  readonly name = 'Sticky';

  order(methods: PaymentMethod[], ctx: ChainStrategyContext): ChainStrategyResult {
    const subAttempts = ctx.priorAttempts
      .filter((a) => a.subscriptionId === ctx.subscriptionId && a.status === 'success')
      .sort((a, b) => b.attemptedAt.getTime() - a.attemptedAt.getTime());

    const stickyMethodId = subAttempts[0]?.paymentMethodId ?? null;

    if (!stickyMethodId) {
      const fallback = new PriorityStrategy().order(methods, ctx);
      return {
        ...fallback,
        rationale: 'No prior success for this subscription — using priority order.',
        strategyId: this.id,
      };
    }

    const stickyMethod = methods.find((m) => m.id === stickyMethodId);
    const rest = methods.filter((m) => m.id !== stickyMethodId);
    const priorityRest = new PriorityStrategy().order(rest, ctx).orderedMethods;

    const ordered = stickyMethod ? [stickyMethod, ...priorityRest] : priorityRest;

    return {
      orderedMethods: ordered,
      rationale: `Sticky: prefer method ${stickyMethodId} (last success for sub ${ctx.subscriptionId}).`,
      strategyId: this.id,
    };
  }
}

/**
 * Use all primary methods in parallel (burst), then fall back.
 * In practice "burst" means: try all primaries before any backup.
 */
export class PriorityBurstStrategy implements ChainStrategy {
  readonly id = 'priority-burst';
  readonly name = 'Priority Burst';

  order(methods: PaymentMethod[], _ctx: ChainStrategyContext): ChainStrategyResult {
    const primaries = methods.filter((m) => m.priority === PaymentPriority.PRIMARY);
    const backups = methods.filter((m) => m.priority === PaymentPriority.BACKUP);
    const fallbacks = methods.filter((m) => m.priority === PaymentPriority.FALLBACK);

    const byLastUsed = (a: PaymentMethod, b: PaymentMethod): number => {
      const aTime = a.lastUsedAt?.getTime() ?? a.createdAt.getTime();
      const bTime = b.lastUsedAt?.getTime() ?? b.createdAt.getTime();
      return bTime - aTime;
    };

    const ordered = [
      ...primaries.sort(byLastUsed),
      ...backups.sort(byLastUsed),
      ...fallbacks.sort(byLastUsed),
    ];

    return {
      orderedMethods: ordered,
      rationale: `Burst: ${primaries.length} primaries, then ${backups.length} backups, then ${fallbacks.length} fallbacks.`,
      strategyId: this.id,
    };
  }
}

/**
 * Prefer methods matching the payment's target chain ID, then fall back to
 * cross-chain methods. Useful when a subscriber has methods on multiple chains.
 */
export class GeoAwareStrategy implements ChainStrategy {
  readonly id = 'geo-aware';
  readonly name = 'Geo-Aware';

  order(methods: PaymentMethod[], ctx: ChainStrategyContext): ChainStrategyResult {
    const onChain = methods.filter((m) => m.chainId === ctx.chainId);
    const offChain = methods.filter((m) => m.chainId !== ctx.chainId);

    const priorityFn = new PriorityStrategy();
    const onChainOrdered = priorityFn.order(onChain, ctx).orderedMethods;
    const offChainOrdered = priorityFn.order(offChain, ctx).orderedMethods;

    return {
      orderedMethods: [...onChainOrdered, ...offChainOrdered],
      rationale: `Geo-aware: ${onChain.length} methods on chain ${ctx.chainId}, then ${offChain.length} on other chains.`,
      strategyId: this.id,
    };
  }
}

/**
 * Distribute charges evenly across primary methods (round-robin by last-used).
 * Prevents over-reliance on a single method when all are equally healthy.
 */
export class RoundRobinStrategy implements ChainStrategy {
  readonly id = 'round-robin';
  readonly name = 'Round Robin';

  order(methods: PaymentMethod[], _ctx: ChainStrategyContext): ChainStrategyResult {
    const primaries = methods.filter((m) => m.priority === PaymentPriority.PRIMARY);
    const nonPrimaries = methods.filter((m) => m.priority !== PaymentPriority.PRIMARY);

    // Sort primaries by last used ascending (least-recently-used first)
    const rrPrimaries = [...primaries].sort((a, b) => {
      const aTime = a.lastUsedAt?.getTime() ?? 0;
      const bTime = b.lastUsedAt?.getTime() ?? 0;
      return aTime - bTime; // ascending: LRU first
    });

    const fallbackPriority = new PriorityStrategy().order(nonPrimaries, {} as ChainStrategyContext).orderedMethods;

    return {
      orderedMethods: [...rrPrimaries, ...fallbackPriority],
      rationale: `Round-robin ${primaries.length} primary methods by LRU, then ${nonPrimaries.length} others.`,
      strategyId: this.id,
    };
  }
}

// ---------------------------------------------------------------------------
// FallbackChainEngine
// ---------------------------------------------------------------------------

export type StrategyId = 'priority' | 'weighted' | 'sticky' | 'priority-burst' | 'geo-aware' | 'round-robin' | string;

export interface FallbackChainEngineOptions {
  defaultStrategy?: StrategyId;
}

export interface EngineChargeResult extends ChainPaymentResult {
  strategyId: string;
  strategyRationale: string;
  orderedMethodIds: string[];
}

export class FallbackChainEngine {
  private readonly _service: PaymentMethodService;
  private readonly _strategies = new Map<string, ChainStrategy>();
  private readonly _defaultStrategyId: StrategyId;

  constructor(
    service?: PaymentMethodService,
    options: FallbackChainEngineOptions = {}
  ) {
    this._service = service ?? PaymentMethodService.getInstance();
    this._defaultStrategyId = options.defaultStrategy ?? 'priority';

    // Register built-ins
    this.registerStrategy(new PriorityStrategy());
    this.registerStrategy(new WeightedStrategy());
    this.registerStrategy(new StickyStrategy());
    this.registerStrategy(new PriorityBurstStrategy());
    this.registerStrategy(new GeoAwareStrategy());
    this.registerStrategy(new RoundRobinStrategy());
  }

  /** Register a custom strategy (or override a built-in). */
  registerStrategy(strategy: ChainStrategy): void {
    this._strategies.set(strategy.id, strategy);
  }

  /** List all registered strategy IDs. */
  listStrategies(): string[] {
    return [...this._strategies.keys()];
  }

  /**
   * Execute a charge using the named strategy to order the methods.
   *
   * @param strategyId - Which ordering strategy to apply. Defaults to 'priority'.
   * @param methods    - Payment methods to consider (will be filtered to active+verified).
   * @param attempts   - Prior attempt history used by sticky/weighted strategies.
   * @param chain      - Optional explicit fallback chain; if provided, its methodIds
   *                     are used as the candidate pool (still filtered active+verified).
   */
  async execute(
    strategyId: StrategyId = this._defaultStrategyId,
    methods: PaymentMethod[],
    attempts: PaymentAttempt[],
    ctx: Omit<ChainStrategyContext, 'priorAttempts' | 'allMethods'> & { chain?: FallbackChain }
  ): Promise<EngineChargeResult> {
    const strategy = this._strategies.get(strategyId);
    if (!strategy) {
      throw new PaymentMethodError(
        PaymentMethodErrorCode.FALLBACK_FAILED,
        `Unknown fallback strategy: "${strategyId}". Registered: ${this.listStrategies().join(', ')}.`,
        'Use a registered strategy ID.'
      );
    }

    // Candidate pool: active+verified methods, optionally scoped by chain
    let candidates = this._service.getActiveVerifiedMethods(methods);
    if (ctx.chain) {
      const inChain = new Set(ctx.chain.methodIds);
      candidates = candidates.filter((m) => inChain.has(m.id));
    }

    if (candidates.length === 0) {
      throw new PaymentMethodError(
        PaymentMethodErrorCode.FALLBACK_FAILED,
        'No active, verified payment methods available.',
        'Add or verify a payment method to continue.'
      );
    }

    const fullCtx: ChainStrategyContext = {
      ...ctx,
      priorAttempts: attempts,
      allMethods: methods,
    };

    const strategyResult = strategy.order(candidates, fullCtx);

    // Build a synthetic chain from the strategy's ordering
    const syntheticChain: FallbackChain = ctx.chain
      ? {
          ...ctx.chain,
          methodIds: strategyResult.orderedMethods.map((m) => m.id),
        }
      : {
          id: `engine_${Date.now()}`,
          name: `${strategy.name} chain`,
          methodIds: strategyResult.orderedMethods.map((m) => m.id),
          subscriptionId: ctx.subscriptionId,
          maxAttempts: 0,
          stopOnHardDecline: false,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

    const chargeResult = await this._service.processPaymentWithChain(
      syntheticChain,
      strategyResult.orderedMethods,
      ctx.subscriptionId,
      ctx.amount,
      ctx.chainId,
      ctx.maxGasPriceGwei
    );

    return {
      ...chargeResult,
      strategyId: strategy.id,
      strategyRationale: strategyResult.rationale,
      orderedMethodIds: strategyResult.orderedMethods.map((m) => m.id),
    };
  }

  /**
   * Preview the method ordering a strategy would produce without actually
   * executing a charge.
   */
  preview(
    strategyId: StrategyId,
    methods: PaymentMethod[],
    attempts: PaymentAttempt[],
    ctx: Omit<ChainStrategyContext, 'priorAttempts' | 'allMethods'>
  ): ChainStrategyResult {
    const strategy = this._strategies.get(strategyId);
    if (!strategy) {
      throw new Error(`Unknown strategy: ${strategyId}`);
    }

    const candidates = this._service.getActiveVerifiedMethods(methods);
    return strategy.order(candidates, {
      ...ctx,
      priorAttempts: attempts,
      allMethods: methods,
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const fallbackChainEngine = new FallbackChainEngine();
