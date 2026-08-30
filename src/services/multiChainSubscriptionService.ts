/**
 * Multi-chain subscription management with unified billing.
 *
 * A payer's subscriptions do not all live on one chain: one is funded from
 * USDC on Polygon, another settles in XLM on Stellar. Left alone that produces
 * one bill per chain, each in its own asset, which is not a bill anyone can
 * read.
 *
 * This service keeps the chain binding of every subscription, then answers two
 * questions the rest of the app needs:
 *
 *  1. *Unified billing* — what does this payer owe in total, in one currency,
 *     across every chain? (`buildUnifiedStatement`)
 *  2. *Settlement* — which wallet on which chain actually pays each charge, and
 *     what has to bridge? (`planSettlement`)
 *
 * Conversion rates and chain health are injected rather than fetched here, so
 * the aggregation logic stays deterministic and testable; production wires in
 * `oraclePriceService` and `networkService` respectively.
 */

import { ChainType } from '../types/wallet';

/** Where a subscription is billed, and from which wallet. */
export interface ChainBinding {
  chainType: ChainType;
  /** EVM chain id, or the Stellar network id from `src/config/networks.ts`. */
  chainId: number;
  networkId: string;
  /** Asset the subscription is denominated in, e.g. `USDC`, `XLM`. */
  tokenSymbol: string;
  /** Wallet that funds this subscription on that chain. */
  walletAddress: string;
}

export interface MultiChainSubscription {
  subscriptionId: string;
  subscriberId: string;
  name: string;
  /** Charge amount per period, denominated in `binding.tokenSymbol`. */
  amount: number;
  binding: ChainBinding;
  nextBillingDate: Date;
  isActive: boolean;
}

/** Rate of one token against the statement currency. */
export interface ConversionRate {
  tokenSymbol: string;
  /** How many units of the statement currency one token is worth. */
  rate: number;
  asOf: Date;
}

export interface ChainHealth {
  networkId: string;
  healthy: boolean;
  latencyMs?: number;
}

export interface UnifiedStatementLine {
  subscriptionId: string;
  name: string;
  networkId: string;
  chainType: ChainType;
  tokenSymbol: string;
  /** Amount in the subscription's own token. */
  nativeAmount: number;
  /** Rate applied to reach `convertedAmount`. */
  rate: number;
  /** Amount in the statement currency. */
  convertedAmount: number;
  nextBillingDate: Date;
}

export interface ChainSubtotal {
  networkId: string;
  chainType: ChainType;
  subscriptionCount: number;
  /** Per-token totals in each token's own units. */
  nativeTotals: Record<string, number>;
  convertedTotal: number;
}

export interface UnifiedStatement {
  subscriberId: string;
  currency: string;
  generatedAt: Date;
  lines: UnifiedStatementLine[];
  /** One entry per chain the payer has active subscriptions on. */
  chainSubtotals: ChainSubtotal[];
  total: number;
  /**
   * Subscriptions left out because no conversion rate was available. Their
   * amounts are excluded from `total` rather than silently counted as zero.
   */
  unpricedSubscriptionIds: string[];
}

export type SettlementAction = 'direct' | 'bridge' | 'blocked';

export interface SettlementStep {
  subscriptionId: string;
  action: SettlementAction;
  /** Chain the funds come from. */
  sourceNetworkId: string;
  /** Chain the charge settles on. */
  targetNetworkId: string;
  tokenSymbol: string;
  amount: number;
  reason?: string;
}

export interface SettlementPlan {
  subscriberId: string;
  steps: SettlementStep[];
  /** Steps needing a cross-chain transfer before they can settle. */
  bridgedCount: number;
  /** Steps that cannot proceed — unhealthy chain with no funded alternative. */
  blockedCount: number;
}

export interface UnifiedStatementOptions {
  currency?: string;
  rates?: ConversionRate[];
  /** Only include subscriptions due on or before this instant. */
  dueBefore?: Date;
  includeInactive?: boolean;
}

export interface SettlementOptions {
  /** Chain health snapshot; chains absent from the list are assumed healthy. */
  health?: ChainHealth[];
  /**
   * Spendable balance per `networkId::tokenSymbol`. A charge on an unhealthy
   * chain reroutes to another chain holding enough of the same token.
   */
  balances?: Record<string, number>;
}

const DEFAULT_CURRENCY = 'USD';

export const balanceKey = (networkId: string, tokenSymbol: string): string =>
  `${networkId}::${tokenSymbol}`;

export class MultiChainSubscriptionService {
  private static instance: MultiChainSubscriptionService;

  private subscriptions = new Map<string, MultiChainSubscription>();

  static getInstance(): MultiChainSubscriptionService {
    if (!MultiChainSubscriptionService.instance) {
      MultiChainSubscriptionService.instance = new MultiChainSubscriptionService();
    }
    return MultiChainSubscriptionService.instance;
  }

  register(subscription: MultiChainSubscription): MultiChainSubscription {
    if (!subscription.subscriptionId) {
      throw new Error('A multi-chain subscription requires a subscriptionId');
    }
    if (!Number.isFinite(subscription.amount) || subscription.amount < 0) {
      throw new Error(
        `Subscription ${subscription.subscriptionId} has a negative or non-finite amount`
      );
    }
    if (!subscription.binding?.networkId) {
      throw new Error(
        `Subscription ${subscription.subscriptionId} is not bound to a network`
      );
    }
    this.subscriptions.set(subscription.subscriptionId, subscription);
    return subscription;
  }

  unregister(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId);
  }

  get(subscriptionId: string): MultiChainSubscription | undefined {
    return this.subscriptions.get(subscriptionId);
  }

  list(subscriberId?: string): MultiChainSubscription[] {
    const all = Array.from(this.subscriptions.values());
    return subscriberId ? all.filter((s) => s.subscriberId === subscriberId) : all;
  }

  /** Distinct networks a payer currently holds subscriptions on. */
  listNetworks(subscriberId: string): string[] {
    return Array.from(new Set(this.list(subscriberId).map((s) => s.binding.networkId)));
  }

  /**
   * Moves a subscription to a different chain — the migration path when a payer
   * switches funding wallets. The billed amount is unchanged; only where it
   * settles moves.
   */
  rebind(subscriptionId: string, binding: ChainBinding): MultiChainSubscription | null {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return null;
    const updated = { ...subscription, binding };
    this.subscriptions.set(subscriptionId, updated);
    return updated;
  }

  /**
   * Aggregates every chain's charges into one statement in a single currency.
   *
   * A subscription whose token has no rate is reported in
   * `unpricedSubscriptionIds` and excluded from the total — a bill that quietly
   * under-reports is worse than one that says what it could not price.
   */
  buildUnifiedStatement(
    subscriberId: string,
    options: UnifiedStatementOptions = {}
  ): UnifiedStatement {
    const currency = options.currency ?? DEFAULT_CURRENCY;
    const rateBySymbol = new Map(
      (options.rates ?? []).map((r) => [r.tokenSymbol.toUpperCase(), r.rate])
    );

    const candidates = this.list(subscriberId).filter((s) => {
      if (!options.includeInactive && !s.isActive) return false;
      if (options.dueBefore && s.nextBillingDate.getTime() > options.dueBefore.getTime()) {
        return false;
      }
      return true;
    });

    const lines: UnifiedStatementLine[] = [];
    const unpricedSubscriptionIds: string[] = [];
    const subtotals = new Map<string, ChainSubtotal>();
    let total = 0;

    for (const subscription of candidates) {
      const { binding } = subscription;
      const symbol = binding.tokenSymbol.toUpperCase();
      // A subscription already denominated in the statement currency needs no
      // rate; anything else does.
      const rate = symbol === currency.toUpperCase() ? 1 : rateBySymbol.get(symbol);

      let subtotal = subtotals.get(binding.networkId);
      if (!subtotal) {
        subtotal = {
          networkId: binding.networkId,
          chainType: binding.chainType,
          subscriptionCount: 0,
          nativeTotals: {},
          convertedTotal: 0,
        };
        subtotals.set(binding.networkId, subtotal);
      }
      subtotal.subscriptionCount += 1;
      subtotal.nativeTotals[binding.tokenSymbol] =
        (subtotal.nativeTotals[binding.tokenSymbol] ?? 0) + subscription.amount;

      if (rate === undefined) {
        unpricedSubscriptionIds.push(subscription.subscriptionId);
        continue;
      }

      const convertedAmount = subscription.amount * rate;
      subtotal.convertedTotal += convertedAmount;
      total += convertedAmount;

      lines.push({
        subscriptionId: subscription.subscriptionId,
        name: subscription.name,
        networkId: binding.networkId,
        chainType: binding.chainType,
        tokenSymbol: binding.tokenSymbol,
        nativeAmount: subscription.amount,
        rate,
        convertedAmount,
        nextBillingDate: subscription.nextBillingDate,
      });
    }

    return {
      subscriberId,
      currency,
      generatedAt: new Date(),
      lines,
      chainSubtotals: Array.from(subtotals.values()),
      total,
      unpricedSubscriptionIds,
    };
  }

  /**
   * Decides how each due charge settles.
   *
   * A charge settles directly when its own chain is healthy. When that chain is
   * down, the plan looks for another chain where the payer holds enough of the
   * same token and routes through a bridge; with no such chain the step is
   * blocked rather than silently dropped.
   */
  planSettlement(
    subscriberId: string,
    options: SettlementOptions = {}
  ): SettlementPlan {
    const healthByNetwork = new Map(
      (options.health ?? []).map((h) => [h.networkId, h.healthy])
    );
    const balances = options.balances ?? {};
    const isHealthy = (networkId: string): boolean =>
      healthByNetwork.get(networkId) ?? true;

    const steps: SettlementStep[] = [];

    for (const subscription of this.list(subscriberId)) {
      if (!subscription.isActive) continue;

      const { binding } = subscription;
      const target = binding.networkId;

      if (isHealthy(target)) {
        steps.push({
          subscriptionId: subscription.subscriptionId,
          action: 'direct',
          sourceNetworkId: target,
          targetNetworkId: target,
          tokenSymbol: binding.tokenSymbol,
          amount: subscription.amount,
        });
        continue;
      }

      const fallback = this.findFundedAlternative(
        subscriberId,
        binding,
        subscription.amount,
        balances,
        isHealthy
      );

      if (fallback) {
        steps.push({
          subscriptionId: subscription.subscriptionId,
          action: 'bridge',
          sourceNetworkId: fallback,
          targetNetworkId: target,
          tokenSymbol: binding.tokenSymbol,
          amount: subscription.amount,
          reason: `${target} is unavailable; routing ${binding.tokenSymbol} from ${fallback}`,
        });
      } else {
        steps.push({
          subscriptionId: subscription.subscriptionId,
          action: 'blocked',
          sourceNetworkId: target,
          targetNetworkId: target,
          tokenSymbol: binding.tokenSymbol,
          amount: subscription.amount,
          reason: `${target} is unavailable and no other chain holds enough ${binding.tokenSymbol}`,
        });
      }
    }

    return {
      subscriberId,
      steps,
      bridgedCount: steps.filter((s) => s.action === 'bridge').length,
      blockedCount: steps.filter((s) => s.action === 'blocked').length,
    };
  }

  /**
   * Finds a healthy chain, other than the failed one, where the payer holds
   * enough of the same token. Candidates are the chains the payer already uses,
   * so a plan never invents a chain the payer has no wallet on.
   */
  private findFundedAlternative(
    subscriberId: string,
    binding: ChainBinding,
    amount: number,
    balances: Record<string, number>,
    isHealthy: (networkId: string) => boolean
  ): string | null {
    for (const networkId of this.listNetworks(subscriberId)) {
      if (networkId === binding.networkId) continue;
      if (!isHealthy(networkId)) continue;
      const available = balances[balanceKey(networkId, binding.tokenSymbol)] ?? 0;
      if (available >= amount) return networkId;
    }
    return null;
  }

  /** Clears registered subscriptions. Intended for tests and sign-out. */
  reset(): void {
    this.subscriptions.clear();
  }
}

export const multiChainSubscriptionService = MultiChainSubscriptionService.getInstance();
