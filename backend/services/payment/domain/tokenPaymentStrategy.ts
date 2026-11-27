/**
 * Multi-chain token payment strategy for ERC20 and Soroban.
 *
 * Issue #2213: Chain-agnostic token handler for payment abstraction.
 *
 * The existing `PaymentRouter` routes fiat and card-based charges across
 * gateway adapters (Stripe, Circle, Stellar, Paddle, Shopify). Token payments
 * — ERC20 transfers on EVM chains and native Stellar asset transfers via
 * Soroban contracts — are a different problem: there is no gateway, just a
 * contract call. This module provides the strategy interface and concrete
 * adapters that let the backend settle a subscription charge in any token on
 * any chain through one `charge()` call.
 *
 * ## Architecture
 *
 * ```
 * TokenPaymentRequest ──▶ TokenPaymentRouter
 *                                │
 *                    ┌───────────┼───────────┐
 *                    ▼           ▼           ▼
 *               ERC20Strategy  SorobanStrategy  (extensible)
 *                    │           │
 *                    ▼           ▼
 *               EVM RPC     Stellar SDK
 *               (ethers)    (soroban-sdk)
 * ```
 *
 * Each strategy implements `ITokenPaymentStrategy`. The router selects the
 * right strategy by `chainType` and delegates. If the chain is unhealthy the
 * router can fall back to an alternative strategy on a different chain, mir
 * the fallback semantics of `MultiChainSubscriptionService.planSettlement`.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type ChainType = 'evm' | 'stellar';

export interface TokenPaymentRequest {
  /** Unique id for this charge attempt (idempotency key). */
  paymentId: string;
  subscriptionId: string;
  /** Payer wallet address. */
  from: string;
  /** Merchant / receiver wallet address. */
  to: string;
  /** Amount in the token's smallest unit (wei for EVM, stroops for XLM). */
  amount: string;
  /** Token contract address (EVM) or Stellar asset issuer (Stellar). */
  tokenAddress: string;
  /** Human-readable symbol for logging and analytics: USDC, XLM, EURC. */
  tokenSymbol: string;
  /** Chain identifier — EVM chain id or Stellar network passphrase. */
  chainId: string;
  chainType: ChainType;
  /** Optional memo / note attached to the transfer. */
  memo?: string;
  /** Optional merchant id for asset-policy enforcement. */
  merchantId?: string;
}

export interface TokenPaymentResult {
  paymentId: string;
  subscriptionId: string;
  status: 'succeeded' | 'failed' | 'pending';
  /** On-chain transaction hash once broadcast. */
  txHash?: string;
  chainType: ChainType;
  chainId: string;
  tokenSymbol: string;
  amount: string;
  /** Gas or fee paid, in the chain's native unit. */
  gasUsed?: string;
  errorMessage?: string;
  processedAt: string;
}

export interface TokenRefundRequest {
  paymentId: string;
  subscriptionId: string;
  originalTxHash: string;
  /** Amount to refund, in the token's smallest unit. */
  amount: string;
  from: string;
  to: string;
  tokenAddress: string;
  tokenSymbol: string;
  chainId: string;
  chainType: ChainType;
  memo?: string;
}

export interface TokenRefundResult {
  paymentId: string;
  status: 'succeeded' | 'failed';
  txHash?: string;
  errorMessage?: string;
  processedAt: string;
}

export interface TokenBalanceQuery {
  address: string;
  tokenAddress: string;
  tokenSymbol: string;
  chainId: string;
  chainType: ChainType;
}

export interface TokenBalanceResult {
  address: string;
  tokenSymbol: string;
  chainId: string;
  /** Balance in the token's smallest unit. */
  balance: string;
  /** Whether the balance check succeeded. */
  ok: boolean;
  errorMessage?: string;
}

// ── Strategy interface ──────────────────────────────────────────────────────

/**
 * A token payment strategy handles charges, refunds, and balance queries for
 * one family of chains (EVM, Stellar, …).
 */
export interface ITokenPaymentStrategy {
  readonly chainType: ChainType;
  readonly name: string;

  charge(request: TokenPaymentRequest): Promise<TokenPaymentResult>;
  refund(request: TokenRefundRequest): Promise<TokenRefundResult>;
  getBalance(query: TokenBalanceQuery): Promise<TokenBalanceResult>;

  /**
   * Whether this strategy can handle the given chain id.  EVM strategies check
   * chain-id ranges; the Stellar strategy checks network passphrase.
   */
  supports(chainId: string): boolean;
}

// ── ERC20 strategy (EVM) ─────────────────────────────────────────────────────

/**
 * Injectable EVM RPC client.  Production wires in ethers.js; tests inject a
 * stub.
 */
export interface EvmRpcClient {
  getChainId(): Promise<number>;
  getBalance(address: string): Promise<string>;
  getTokenBalance(tokenAddress: string, walletAddress: string): Promise<string>;
  transferToken(
    tokenAddress: string,
    from: string,
    to: string,
    amount: string
  ): Promise<{ txHash: string; gasUsed: string }>;
  estimateTransferGas(tokenAddress: string, from: string, to: string, amount: string): Promise<string>;
  isHealthy(): Promise<boolean>;
}

/**
 * ERC20 token payment strategy for EVM chains (Ethereum, Polygon, etc.).
 *
 * Transfers are `token.transfer(to, amount)` calls. The strategy does not hold
 * private keys — it delegates signing to the injected `EvmRpcClient`, which in
 * production is backed by a wallet provider or hardware signer.
 */
export class ERC20TokenPaymentStrategy implements ITokenPaymentStrategy {
  readonly chainType: ChainType = 'evm';
  readonly name = 'erc20';

  private clients = new Map<string, EvmRpcClient>();

  constructor(
    /** Map of chain id → RPC client. */
    clients: Record<string, EvmRpcClient> = {},
    /** Chain ids this strategy supports. */
    private supportedChainIds: string[] = Object.keys(clients),
  ) {
    for (const [id, client] of Object.entries(clients)) {
      this.clients.set(id, client);
    }
  }

  supports(chainId: string): boolean {
    return this.clients.has(chainId);
  }

  async charge(request: TokenPaymentRequest): Promise<TokenPaymentResult> {
    const now = new Date().toISOString();

    if (request.chainType !== 'evm') {
      return this.fail(request, 'ERC20 strategy only handles EVM chains', now);
    }

    const client = this.clients.get(request.chainId);
    if (!client) {
      return this.fail(request, `No RPC client registered for chain ${request.chainId}`, now);
    }

    try {
      // Pre-flight balance check — fail fast instead of broadcasting a tx that
      // will revert.
      const balance = await client.getTokenBalance(request.tokenAddress, request.from);
      if (BigInt(balance) < BigInt(request.amount)) {
        return this.fail(
          request,
          `Insufficient ${request.tokenSymbol} balance: have ${balance}, need ${request.amount}`,
          now,
        );
      }

      const result = await client.transferToken(
        request.tokenAddress,
        request.from,
        request.to,
        request.amount,
      );

      return {
        paymentId: request.paymentId,
        subscriptionId: request.subscriptionId,
        status: 'succeeded',
        txHash: result.txHash,
        chainType: 'evm',
        chainId: request.chainId,
        tokenSymbol: request.tokenSymbol,
        amount: request.amount,
        gasUsed: result.gasUsed,
        processedAt: now,
      };
    } catch (err) {
      return this.fail(request, err instanceof Error ? err.message : String(err), now);
    }
  }

  async refund(request: TokenRefundRequest): Promise<TokenRefundResult> {
    const now = new Date().toISOString();
    const client = this.clients.get(request.chainId);
    if (!client) {
      return {
        paymentId: request.paymentId,
        status: 'failed',
        errorMessage: `No RPC client for chain ${request.chainId}`,
        processedAt: now,
      };
    }

    try {
      // Refund is a transfer from the merchant back to the payer.
      const result = await client.transferToken(
        request.tokenAddress,
        request.from,
        request.to,
        request.amount,
      );
      return {
        paymentId: request.paymentId,
        status: 'succeeded',
        txHash: result.txHash,
        processedAt: now,
      };
    } catch (err) {
      return {
        paymentId: request.paymentId,
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
        processedAt: now,
      };
    }
  }

  async getBalance(query: TokenBalanceQuery): Promise<TokenBalanceResult> {
    const client = this.clients.get(query.chainId);
    if (!client) {
      return {
        address: query.address,
        tokenSymbol: query.tokenSymbol,
        chainId: query.chainId,
        balance: '0',
        ok: false,
        errorMessage: `No RPC client for chain ${query.chainId}`,
      };
    }

    try {
      const balance = await client.getTokenBalance(query.tokenAddress, query.address);
      return {
        address: query.address,
        tokenSymbol: query.tokenSymbol,
        chainId: query.chainId,
        balance,
        ok: true,
      };
    } catch (err) {
      return {
        address: query.address,
        tokenSymbol: query.tokenSymbol,
        chainId: query.chainId,
        balance: '0',
        ok: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private fail(request: TokenPaymentRequest, message: string, now: string): TokenPaymentResult {
    return {
      paymentId: request.paymentId,
      subscriptionId: request.subscriptionId,
      status: 'failed',
      chainType: 'evm',
      chainId: request.chainId,
      tokenSymbol: request.tokenSymbol,
      amount: request.amount,
      errorMessage: message,
      processedAt: now,
    };
  }
}

// ── Soroban strategy (Stellar) ───────────────────────────────────────────────

/**
 * Injectable Stellar/Soroban client. Production wires in the Stellar SDK;
 * tests inject a stub.
 */
export interface SorobanClient {
  /** Submit a token transfer via the Soroban contract. */
  transferToken(
    contractId: string,
    from: string,
    to: string,
    amount: string,
    memo?: string,
  ): Promise<{ txHash: string; feeUsed: string }>;

  getTokenBalance(contractId: string, address: string): Promise<string>;

  /** Whether the Stellar network is reachable. */
  isHealthy(): Promise<boolean>;

  /** Current network passphrase this client targets. */
  getNetworkPassphrase(): string;
}

/**
 * Soroban token payment strategy for the Stellar network.
 *
 * Soroban contracts expose a `transfer` function compatible with the SAC
 * (Stellar Asset Contract) interface. This strategy wraps those calls.
 */
export class SorobanTokenPaymentStrategy implements ITokenPaymentStrategy {
  readonly chainType: ChainType = 'stellar';
  readonly name = 'soroban';

  constructor(
    private client: SorobanClient,
    /** Network passphrases this strategy accepts. */
    private networkPassphrases: string[] = ['Public Global Stellar Network ; September 2015'],
  ) {}

  supports(chainId: string): boolean {
    return this.networkPassphrases.includes(chainId);
  }

  async charge(request: TokenPaymentRequest): Promise<TokenPaymentResult> {
    const now = new Date().toISOString();

    if (request.chainType !== 'stellar') {
      return {
        paymentId: request.paymentId,
        subscriptionId: request.subscriptionId,
        status: 'failed',
        chainType: 'stellar',
        chainId: request.chainId,
        tokenSymbol: request.tokenSymbol,
        amount: request.amount,
        errorMessage: 'Soroban strategy only handles Stellar chains',
        processedAt: now,
      };
    }

    if (!this.supports(request.chainId)) {
      return {
        paymentId: request.paymentId,
        subscriptionId: request.subscriptionId,
        status: 'failed',
        chainType: 'stellar',
        chainId: request.chainId,
        tokenSymbol: request.tokenSymbol,
        amount: request.amount,
        errorMessage: `Unsupported Stellar network: ${request.chainId}`,
        processedAt: now,
      };
    }

    try {
      // Pre-flight balance check.
      const balance = await this.client.getTokenBalance(request.tokenAddress, request.from);
      if (BigInt(balance) < BigInt(request.amount)) {
        return {
          paymentId: request.paymentId,
          subscriptionId: request.subscriptionId,
          status: 'failed',
          chainType: 'stellar',
          chainId: request.chainId,
          tokenSymbol: request.tokenSymbol,
          amount: request.amount,
          errorMessage: `Insufficient ${request.tokenSymbol} balance: have ${balance}, need ${request.amount}`,
          processedAt: now,
        };
      }

      const result = await this.client.transferToken(
        request.tokenAddress,
        request.from,
        request.to,
        request.amount,
        request.memo,
      );

      return {
        paymentId: request.paymentId,
        subscriptionId: request.subscriptionId,
        status: 'succeeded',
        txHash: result.txHash,
        chainType: 'stellar',
        chainId: request.chainId,
        tokenSymbol: request.tokenSymbol,
        amount: request.amount,
        gasUsed: result.feeUsed,
        processedAt: now,
      };
    } catch (err) {
      return {
        paymentId: request.paymentId,
        subscriptionId: request.subscriptionId,
        status: 'failed',
        chainType: 'stellar',
        chainId: request.chainId,
        tokenSymbol: request.tokenSymbol,
        amount: request.amount,
        errorMessage: err instanceof Error ? err.message : String(err),
        processedAt: now,
      };
    }
  }

  async refund(request: TokenRefundRequest): Promise<TokenRefundResult> {
    const now = new Date().toISOString();

    if (!this.supports(request.chainId)) {
      return {
        paymentId: request.paymentId,
        status: 'failed',
        errorMessage: `Unsupported Stellar network: ${request.chainId}`,
        processedAt: now,
      };
    }

    try {
      const result = await this.client.transferToken(
        request.tokenAddress,
        request.from,
        request.to,
        request.amount,
        request.memo ?? `refund:${request.paymentId}`,
      );
      return {
        paymentId: request.paymentId,
        status: 'succeeded',
        txHash: result.txHash,
        processedAt: now,
      };
    } catch (err) {
      return {
        paymentId: request.paymentId,
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
        processedAt: now,
      };
    }
  }

  async getBalance(query: TokenBalanceQuery): Promise<TokenBalanceResult> {
    if (!this.supports(query.chainId)) {
      return {
        address: query.address,
        tokenSymbol: query.tokenSymbol,
        chainId: query.chainId,
        balance: '0',
        ok: false,
        errorMessage: `Unsupported Stellar network: ${query.chainId}`,
      };
    }

    try {
      const balance = await this.client.getTokenBalance(query.tokenAddress, query.address);
      return {
        address: query.address,
        tokenSymbol: query.tokenSymbol,
        chainId: query.chainId,
        balance,
        ok: true,
      };
    } catch (err) {
      return {
        address: query.address,
        tokenSymbol: query.tokenSymbol,
        chainId: query.chainId,
        balance: '0',
        ok: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// ── Router ───────────────────────────────────────────────────────────────────

export interface TokenPaymentRouterOptions {
  /**
   * Fallback chain mapping. When the primary chain is unhealthy, the router
   * tries these alternatives in order.
   * Example: { '1': ['137', '42161'] } — Ethereum falls back to Polygon, then
   * Arbitrum.
   */
  fallbackChains?: Record<string, string[]>;
}

/**
 * Routes token payment requests to the appropriate strategy by chain type.
 *
 * If the primary chain is unhealthy and fallback chains are configured, the
 * router reroutes to the first healthy alternative, mirroring the settlement
 * semantics in `MultiChainSubscriptionService.planSettlement`.
 */
export class TokenPaymentRouter {
  private strategies = new Map<ChainType, ITokenPaymentStrategy>();
  private fallbackChains: Record<string, string[]>;

  constructor(
    strategies: ITokenPaymentStrategy[] = [],
    options: TokenPaymentRouterOptions = {},
  ) {
    for (const strategy of strategies) {
      this.strategies.set(strategy.chainType, strategy);
    }
    this.fallbackChains = options.fallbackChains ?? {};
  }

  registerStrategy(strategy: ITokenPaymentStrategy): void {
    this.strategies.set(strategy.chainType, strategy);
  }

  getStrategy(chainType: ChainType): ITokenPaymentStrategy | undefined {
    return this.strategies.get(chainType);
  }

  /**
   * Charge a subscription payment in tokens on the requested chain.
   *
   * If the charge fails on the primary chain and fallback chains are
   * configured, the router retries on each healthy alternative before giving
   * up.
   */
  async charge(request: TokenPaymentRequest): Promise<TokenPaymentResult> {
    const strategy = this.strategies.get(request.chainType);
    if (!strategy) {
      return {
        paymentId: request.paymentId,
        subscriptionId: request.subscriptionId,
        status: 'failed',
        chainType: request.chainType,
        chainId: request.chainId,
        tokenSymbol: request.tokenSymbol,
        amount: request.amount,
        errorMessage: `No strategy registered for chain type "${request.chainType}"`,
        processedAt: new Date().toISOString(),
      };
    }

    const result = await strategy.charge(request);
    if (result.status === 'succeeded') return result;

    // Try fallback chains.
    const alternatives = this.fallbackChains[request.chainId] ?? [];
    for (const altChainId of alternatives) {
      const altStrategy = this.findStrategyForChain(altChainId);
      if (!altStrategy) continue;

      const altRequest: TokenPaymentRequest = {
        ...request,
        chainId: altChainId,
        chainType: altStrategy.chainType,
      };

      const altResult = await altStrategy.charge(altRequest);
      if (altResult.status === 'succeeded') {
        altResult.errorMessage = `Primary chain ${request.chainId} failed (${result.errorMessage}); settled on ${altChainId}`;
        return altResult;
      }
    }

    return result;
  }

  async refund(request: TokenRefundRequest): Promise<TokenRefundResult> {
    const strategy = this.strategies.get(request.chainType);
    if (!strategy) {
      return {
        paymentId: request.paymentId,
        status: 'failed',
        errorMessage: `No strategy for chain type "${request.chainType}"`,
        processedAt: new Date().toISOString(),
      };
    }

    return strategy.refund(request);
  }

  async getBalance(query: TokenBalanceQuery): Promise<TokenBalanceResult> {
    const strategy = this.strategies.get(query.chainType);
    if (!strategy) {
      return {
        address: query.address,
        tokenSymbol: query.tokenSymbol,
        chainId: query.chainId,
        balance: '0',
        ok: false,
        errorMessage: `No strategy for chain type "${query.chainType}"`,
      };
    }
    return strategy.getBalance(query);
  }

  /**
   * Find a strategy that supports the given chain id by checking each
   * registered strategy's `supports()` method.
   */
  private findStrategyForChain(chainId: string): ITokenPaymentStrategy | undefined {
    for (const strategy of this.strategies.values()) {
      if (strategy.supports(chainId)) return strategy;
    }
    return undefined;
  }
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class TokenPaymentError extends Error {
  constructor(
    message: string,
    readonly code: 'INSUFFICIENT_BALANCE' | 'UNSUPPORTED_CHAIN' | 'TRANSFER_FAILED' | 'NO_STRATEGY',
  ) {
    super(message);
    this.name = 'TokenPaymentError';
  }
}
