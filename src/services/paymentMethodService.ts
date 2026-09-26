import { ethers } from 'ethers';

import { getEvmRpcUrl } from '../config/evm';
import { CHAIN_IDS } from '../utils/constants/values';
import {
  PaymentMethod,
  PaymentPriority,
  TokenType,
  PaymentMethodValidationResult,
  PaymentAttempt,
  FallbackChain,
  FallbackChainValidation,
  PaymentMethodAnalytics,
  PaymentMethodExpiryAlert,
  PaymentMethodShare,
  PaymentMethodShareRole,
  PaymentMethodStats,
} from '../types/wallet';
import { WalletConnection } from './walletServiceShared';

export enum PaymentMethodErrorCode {
  DUPLICATE = 'PAYMENT_METHOD_DUPLICATE',
  INVALID_TOKEN = 'PAYMENT_METHOD_INVALID_TOKEN',
  INVALID_CHAIN = 'PAYMENT_METHOD_INVALID_CHAIN',
  MAX_METHODS = 'PAYMENT_METHOD_MAX_REACHED',
  VERIFICATION_FAILED = 'PAYMENT_METHOD_VERIFICATION_FAILED',
  EXPIRED = 'PAYMENT_METHOD_EXPIRED',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  GAS_PRICE_SPIKE = 'GAS_PRICE_SPIKE',
  TOKEN_CONTRACT_UPGRADED = 'TOKEN_CONTRACT_UPGRADED',
  FALLBACK_FAILED = 'FALLBACK_FAILED',
}

export class PaymentMethodError extends Error {
  readonly code: PaymentMethodErrorCode;
  readonly userMessage: string;
  readonly recovery?: string;

  constructor(
    code: PaymentMethodErrorCode,
    userMessage: string,
    recovery?: string,
    cause?: unknown
  ) {
    super(userMessage);
    this.name = 'PaymentMethodError';
    this.code = code;
    this.userMessage = userMessage;
    this.recovery = recovery;
    if (cause instanceof Error && cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

const MAX_PAYMENT_METHODS_PER_USER = 10;
const EXPIRY_WARNING_DAYS = 30;
/** Below this many days an expiry alert is raised as critical, not a warning. */
export const EXPIRY_CRITICAL_DAYS = 7;
/** Ceiling on methods in one fallback chain. */
export const MAX_CHAIN_LENGTH = 5;
const TOKEN_TYPE_TO_NATIVE_SYMBOL: Record<number, Record<TokenType, string>> = {
  [CHAIN_IDS.ETHEREUM]: { XLM: '', USDC: 'USDC', ETH: 'ETH', NATIVE: 'ETH', MATIC: '', ARB: '' },
  [CHAIN_IDS.POLYGON]: {
    XLM: '',
    USDC: 'USDC',
    ETH: 'ETH',
    NATIVE: 'MATIC',
    MATIC: 'MATIC',
    ARB: '',
  },
  [CHAIN_IDS.ARBITRUM]: { XLM: '', USDC: 'USDC', ETH: 'ETH', NATIVE: 'ETH', MATIC: '', ARB: 'ARB' },
};

const PRIORITY_ORDER: Record<PaymentPriority, number> = {
  [PaymentPriority.PRIMARY]: 0,
  [PaymentPriority.BACKUP]: 1,
  [PaymentPriority.FALLBACK]: 2,
};

export interface PaymentMethodExpiryCheck {
  method: PaymentMethod;
  daysUntilExpiry: number | null;
  isExpired: boolean;
  isExpiringSoon: boolean;
}

/** Outcome of running a charge through an explicit fallback chain. */
export interface ChainPaymentResult {
  chainId: string;
  success: boolean;
  /** The attempt that succeeded, `null` when the whole chain failed. */
  attempt: PaymentAttempt | null;
  /** Every attempt that failed before the successful one. */
  fallbackAttempts: PaymentAttempt[];
  /** Zero-based position in the chain that succeeded, `-1` on total failure. */
  succeededAtPosition: number;
  /** True when the chain stopped early on a hard decline. */
  haltedOnHardDecline: boolean;
}

export class PaymentMethodService {
  private static instance: PaymentMethodService;
  private walletManager: { getConnection(): WalletConnection | null } | null = null;

  static getInstance(walletManager?: {
    getConnection(): WalletConnection | null;
  }): PaymentMethodService {
    if (!PaymentMethodService.instance) {
      PaymentMethodService.instance = new PaymentMethodService(walletManager ?? null);
    } else if (walletManager) {
      PaymentMethodService.instance.setWalletManager(walletManager);
    }
    return PaymentMethodService.instance;
  }

  constructor(walletManager: { getConnection(): WalletConnection | null } | null = null) {
    this.walletManager = walletManager;
  }

  setWalletManager(walletManager: { getConnection(): WalletConnection | null } | null): void {
    this.walletManager = walletManager;
  }

  generateId(): string {
    return `pm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  validatePaymentMethodForm(data: {
    tokenType: TokenType;
    tokenAddress: string;
    chainId: number;
    label: string;
    priority: PaymentPriority;
    maxSpendPerInterval: string;
  }): PaymentMethodValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!Object.values(TokenType).includes(data.tokenType)) {
      errors.push(`Unsupported token type: ${data.tokenType}`);
    }

    if (data.tokenType !== TokenType.NATIVE && !ethers.utils.isAddress(data.tokenAddress)) {
      errors.push('Invalid token address');
    }

    const validChainIds = Object.values(CHAIN_IDS) as number[];
    if (!validChainIds.includes(data.chainId)) {
      errors.push(`Unsupported chain ID: ${data.chainId}`);
    }

    if (!data.label || data.label.trim().length === 0) {
      errors.push('Label is required');
    }

    if (
      !data.maxSpendPerInterval ||
      isNaN(Number(data.maxSpendPerInterval)) ||
      Number(data.maxSpendPerInterval) <= 0
    ) {
      errors.push('Max spend per interval must be a positive number');
    }

    const nativeSymbol = TOKEN_TYPE_TO_NATIVE_SYMBOL[data.chainId]?.[data.tokenType];
    if (nativeSymbol === '') {
      warnings.push(`Token type ${data.tokenType} may not be supported on chain ${data.chainId}`);
    }

    if (Number(data.maxSpendPerInterval) > 1e12) {
      warnings.push('Max spend per interval is very high; consider setting a lower cap');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      requiresVerification: data.tokenType !== TokenType.NATIVE,
      estimatedGas: null,
    };
  }

  async verifyPaymentMethod(method: PaymentMethod): Promise<boolean> {
    const conn = this.walletManager?.getConnection();
    if (!conn || !conn.isConnected) {
      throw new PaymentMethodError(
        PaymentMethodErrorCode.VERIFICATION_FAILED,
        'Wallet not connected.',
        'Connect your wallet to verify payment methods.'
      );
    }

    if (method.tokenType === TokenType.NATIVE) {
      return true;
    }

    try {
      const provider = new ethers.providers.JsonRpcProvider(getEvmRpcUrl(method.chainId));
      const erc20Abi = [
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)',
      ];
      const contract = new ethers.Contract(method.tokenAddress, erc20Abi, provider);

      const decimals = await contract.decimals();
      if (decimals < 0 || decimals > 18) {
        throw new Error('Invalid decimals');
      }

      const symbol = await contract.symbol();
      const expectedSymbol = method.tokenType.toString();
      if (symbol.toUpperCase() !== expectedSymbol.toUpperCase() && expectedSymbol !== 'NATIVE') {
        throw new Error(`Symbol mismatch: expected ${expectedSymbol}, got ${symbol}`);
      }

      return true;
    } catch (error) {
      throw new PaymentMethodError(
        PaymentMethodErrorCode.VERIFICATION_FAILED,
        `Failed to verify token ${method.tokenAddress}.`,
        'Check the token address and try again.',
        error
      );
    }
  }

  sortByPriority(methods: PaymentMethod[]): PaymentMethod[] {
    return [...methods].sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (priorityDiff !== 0) return priorityDiff;

      const aTime = a.lastUsedAt?.getTime() ?? a.createdAt.getTime();
      const bTime = b.lastUsedAt?.getTime() ?? b.createdAt.getTime();
      return bTime - aTime;
    });
  }

  getPrimaryMethods(methods: PaymentMethod[]): PaymentMethod[] {
    return methods.filter(
      (m) => m.priority === PaymentPriority.PRIMARY && m.isActive && m.isVerified
    );
  }

  getBackupMethods(methods: PaymentMethod[]): PaymentMethod[] {
    return methods.filter(
      (m) => m.priority === PaymentPriority.BACKUP && m.isActive && m.isVerified
    );
  }

  getFallbackMethods(methods: PaymentMethod[]): PaymentMethod[] {
    return methods.filter(
      (m) => m.priority === PaymentPriority.FALLBACK && m.isActive && m.isVerified
    );
  }

  getActiveVerifiedMethods(methods: PaymentMethod[]): PaymentMethod[] {
    return this.sortByPriority(methods.filter((m) => m.isActive && m.isVerified));
  }

  calculateFallbackOrder(methods: PaymentMethod[]): PaymentMethod[] {
    const active = this.getActiveVerifiedMethods(methods);
    return this.sortByPriority(active);
  }

  canAddMethod(currentCount: number): { canAdd: boolean; reason?: string } {
    if (currentCount >= MAX_PAYMENT_METHODS_PER_USER) {
      return {
        canAdd: false,
        reason: `Maximum of ${MAX_PAYMENT_METHODS_PER_USER} payment methods reached.`,
      };
    }
    return { canAdd: true };
  }

  isDuplicateMethod(
    existingMethods: PaymentMethod[],
    tokenAddress: string,
    chainId: number,
    tokenType: TokenType
  ): boolean {
    return existingMethods.some(
      (m) =>
        m.tokenAddress.toLowerCase() === tokenAddress.toLowerCase() &&
        m.chainId === chainId &&
        m.tokenType === tokenType
    );
  }

  ensurePriorityBalance(methods: PaymentMethod[]): void {
    const priorities = [PaymentPriority.PRIMARY, PaymentPriority.BACKUP, PaymentPriority.FALLBACK];
    const present = new Set(methods.map((m) => m.priority));

    for (const priority of priorities) {
      if (!present.has(priority)) {
        throw new PaymentMethodError(
          PaymentMethodErrorCode.INVALID_TOKEN,
          `No payment method with priority "${priority}" exists. Add a method with this priority level.`,
          'Configure at least one payment method per priority level.'
        );
      }
    }
  }

  async checkBalance(
    method: PaymentMethod,
    requiredAmount: string,
    chainId: number
  ): Promise<{ sufficient: boolean; balance: string; symbol: string }> {
    try {
      const provider = new ethers.providers.JsonRpcProvider(getEvmRpcUrl(chainId));
      const conn = this.walletManager?.getConnection();
      if (!conn) {
        return { sufficient: false, balance: '0', symbol: method.tokenType };
      }

      let balance: ethers.BigNumber;

      if (method.tokenType === TokenType.NATIVE) {
        balance = await provider.getBalance(conn.address);
      } else {
        const erc20Abi = ['function balanceOf(address) view returns (uint256)'];
        const contract = new ethers.Contract(method.tokenAddress, erc20Abi, provider);
        balance = await contract.balanceOf(conn.address);
      }

      const required = ethers.utils.parseUnits(
        requiredAmount,
        method.tokenType === TokenType.USDC ? 6 : 18
      );
      return {
        sufficient: balance.gte(required),
        balance: balance.toString(),
        symbol: method.tokenType.toString(),
      };
    } catch {
      return { sufficient: false, balance: '0', symbol: method.tokenType.toString() };
    }
  }

  async validateGasPrice(
    chainId: number,
    maxGasPriceGwei: number
  ): Promise<{ acceptable: boolean; currentGasPrice: string }> {
    try {
      const provider = new ethers.providers.JsonRpcProvider(getEvmRpcUrl(chainId));
      const gasPrice = await provider.getGasPrice();
      const gasPriceGwei = parseFloat(ethers.utils.formatUnits(gasPrice, 'gwei'));

      return {
        acceptable: gasPriceGwei <= maxGasPriceGwei,
        currentGasPrice: gasPriceGwei.toFixed(2),
      };
    } catch {
      return { acceptable: false, currentGasPrice: '0' };
    }
  }

  checkExpiry(method: PaymentMethod): PaymentMethodExpiryCheck {
    if (!method.expiresAt) {
      return { method, daysUntilExpiry: null, isExpired: false, isExpiringSoon: false };
    }

    const now = Date.now();
    const expiryTime = method.expiresAt.getTime();
    const daysUntilExpiry = Math.ceil((expiryTime - now) / (1000 * 60 * 60 * 24));
    const isExpired = daysUntilExpiry <= 0;
    const isExpiringSoon = !isExpired && daysUntilExpiry <= EXPIRY_WARNING_DAYS;

    return { method, daysUntilExpiry, isExpired, isExpiringSoon };
  }

  getExpiredMethods(methods: PaymentMethod[]): PaymentMethod[] {
    return methods.filter((m) => {
      const check = this.checkExpiry(m);
      return check.isExpired;
    });
  }

  getExpiringSoonMethods(methods: PaymentMethod[]): PaymentMethod[] {
    return methods.filter((m) => {
      const check = this.checkExpiry(m);
      return check.isExpiringSoon;
    });
  }

  async processPaymentWithFallback(
    paymentMethods: PaymentMethod[],
    subscriptionId: string,
    amount: string,
    chainId: number,
    maxGasPriceGwei: number = 500
  ): Promise<{ success: boolean; attempt: PaymentAttempt; fallbackAttempts: PaymentAttempt[] }> {
    const sorted = this.calculateFallbackOrder(paymentMethods);
    if (sorted.length === 0) {
      throw new PaymentMethodError(
        PaymentMethodErrorCode.FALLBACK_FAILED,
        'No active payment methods available.',
        'Add at least one verified payment method.'
      );
    }

    const fallbackAttempts: PaymentAttempt[] = [];

    for (const method of sorted) {
      const attempt: PaymentAttempt = {
        id: `attempt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        paymentMethodId: method.id,
        subscriptionId,
        amount,
        tokenType: method.tokenType,
        status: 'pending',
        attemptedAt: new Date(),
      };

      try {
        const expiry = this.checkExpiry(method);
        if (expiry.isExpired) {
          attempt.status = 'failed';
          attempt.failureReason = `Payment method expired ${expiry.daysUntilExpiry} days ago`;
          attempt.resolvedAt = new Date();
          fallbackAttempts.push(attempt);
          continue;
        }

        const gasCheck = await this.validateGasPrice(chainId, maxGasPriceGwei);
        if (!gasCheck.acceptable) {
          attempt.status = 'failed';
          attempt.failureReason = `Gas price ${gasCheck.currentGasPrice} gwei exceeds max ${maxGasPriceGwei} gwei`;
          attempt.gasPrice = gasCheck.currentGasPrice;
          attempt.resolvedAt = new Date();
          fallbackAttempts.push(attempt);
          continue;
        }

        const balanceCheck = await this.checkBalance(method, amount, chainId);
        if (!balanceCheck.sufficient) {
          attempt.status = 'failed';
          attempt.failureReason = `Insufficient ${method.tokenType} balance: have ${balanceCheck.balance}, need ${amount}`;
          attempt.resolvedAt = new Date();
          fallbackAttempts.push(attempt);
          continue;
        }

        if (
          method.maxSpendPerInterval &&
          ethers.BigNumber.from(amount).gt(method.maxSpendPerInterval)
        ) {
          attempt.status = 'failed';
          attempt.failureReason = `Amount ${amount} exceeds max spend per interval ${method.maxSpendPerInterval}`;
          attempt.resolvedAt = new Date();
          fallbackAttempts.push(attempt);
          continue;
        }

        attempt.status = 'success';
        attempt.gasPrice = gasCheck.currentGasPrice;
        attempt.resolvedAt = new Date();
        method.lastUsedAt = new Date();

        return { success: true, attempt, fallbackAttempts };
      } catch (error) {
        attempt.status = 'failed';
        attempt.failureReason = error instanceof Error ? error.message : 'Unknown error';
        attempt.resolvedAt = new Date();
        fallbackAttempts.push(attempt);
      }
    }

    throw new PaymentMethodError(
      PaymentMethodErrorCode.FALLBACK_FAILED,
      `All ${sorted.length} payment methods failed.`,
      'Check your balances, gas prices, and payment method configurations.',
      new Error(
        `Failed attempts: ${fallbackAttempts.map((a) => `${a.tokenType}: ${a.failureReason}`).join('; ')}`
      )
    );
  }

  async detectTokenContractUpgrade(
    method: PaymentMethod,
    previousHash: string | null
  ): Promise<{ upgraded: boolean; newHash?: string }> {
    if (method.tokenType === TokenType.NATIVE || !method.tokenAddress) {
      return { upgraded: false };
    }

    try {
      const provider = new ethers.providers.JsonRpcProvider(getEvmRpcUrl(method.chainId));
      const code = await provider.getCode(method.tokenAddress);
      const newHash = ethers.utils.keccak256(code);

      if (previousHash && newHash !== previousHash) {
        return { upgraded: true, newHash };
      }

      return { upgraded: false, newHash };
    } catch {
      return { upgraded: false };
    }
  }

  markPaymentMethodExpired(method: PaymentMethod): PaymentMethod {
    return {
      ...method,
      isActive: false,
      metadata: {
        ...method.metadata,
        deactivated_reason: 'expired',
        deactivated_at: new Date().toISOString(),
      },
      updatedAt: new Date(),
    };
  }

  // ── Fallback chains ──────────────────────────────────────────────────

  /**
   * Build a chain from the priority ordering, so a merchant who has never
   * configured one still gets a sensible default.
   */
  buildDefaultChain(methods: PaymentMethod[], name = 'Default'): FallbackChain {
    const now = new Date();
    return {
      id: `chain_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name,
      methodIds: this.calculateFallbackOrder(methods)
        .slice(0, MAX_CHAIN_LENGTH)
        .map((m) => m.id),
      subscriptionId: null,
      maxAttempts: 0,
      stopOnHardDecline: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * A chain is valid when it names at least one known method, stays within
   * `MAX_CHAIN_LENGTH`, and lists no method twice.
   */
  validateChain(chain: FallbackChain, methods: PaymentMethod[]): FallbackChainValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!chain.name?.trim()) errors.push('Chain name is required.');
    if (chain.methodIds.length === 0) {
      errors.push('A fallback chain needs at least one payment method.');
    }
    if (chain.methodIds.length > MAX_CHAIN_LENGTH) {
      errors.push(`A fallback chain holds at most ${MAX_CHAIN_LENGTH} methods.`);
    }
    if (chain.maxAttempts < 0) errors.push('Max attempts cannot be negative.');

    const seen = new Set<string>();
    for (const id of chain.methodIds) {
      if (seen.has(id)) errors.push(`Payment method ${id} appears twice in the chain.`);
      seen.add(id);
      if (!methods.some((m) => m.id === id)) {
        errors.push(`Payment method ${id} does not exist.`);
      }
    }

    const resolved = this.resolveChainMethods(chain, methods);
    if (errors.length === 0 && resolved.length === 0) {
      errors.push('Every method in this chain is inactive, unverified or expired.');
    }
    if (resolved.length === 1) {
      warnings.push('A single-method chain has no fallback if that method fails.');
    }
    if (resolved.length < chain.methodIds.length && errors.length === 0) {
      warnings.push('Some methods in this chain are inactive, unverified or expired.');
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * The methods a chain will actually attempt, in order: known, active,
   * verified and unexpired, capped by `maxAttempts`.
   */
  resolveChainMethods(chain: FallbackChain, methods: PaymentMethod[]): PaymentMethod[] {
    const byId = new Map(methods.map((method) => [method.id, method]));
    const usable = chain.methodIds
      .map((id) => byId.get(id))
      .filter((method): method is PaymentMethod => {
        if (!method || !method.isActive || !method.isVerified) return false;
        return !this.checkExpiry(method).isExpired;
      });

    return chain.maxAttempts > 0 ? usable.slice(0, chain.maxAttempts) : usable;
  }

  /** The chain that applies to a subscription: its own, else the global one. */
  selectChainForSubscription(
    chains: FallbackChain[],
    subscriptionId: string
  ): FallbackChain | null {
    const active = chains.filter((chain) => chain.isActive);
    return (
      active.find((chain) => chain.subscriptionId === subscriptionId) ??
      active.find((chain) => chain.subscriptionId === null) ??
      null
    );
  }

  /**
   * Charge through an explicit chain rather than the implicit priority order.
   *
   * Each entry is tried in turn until one succeeds. A hard decline — an
   * expired or deactivated method — halts the chain when the chain is
   * configured that way, since falling through would only repeat a
   * configuration problem.
   */
  async processPaymentWithChain(
    chain: FallbackChain,
    paymentMethods: PaymentMethod[],
    subscriptionId: string,
    amount: string,
    chainId: number,
    maxGasPriceGwei: number = 500
  ): Promise<ChainPaymentResult> {
    const ordered = this.resolveChainMethods(chain, paymentMethods);
    if (ordered.length === 0) {
      throw new PaymentMethodError(
        PaymentMethodErrorCode.FALLBACK_FAILED,
        `Fallback chain "${chain.name}" has no usable payment method.`,
        'Add a verified, unexpired method to the chain.'
      );
    }

    const fallbackAttempts: PaymentAttempt[] = [];

    for (let position = 0; position < ordered.length; position++) {
      const method = ordered[position];
      const attempt: PaymentAttempt = {
        id: `attempt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        paymentMethodId: method.id,
        subscriptionId,
        amount,
        tokenType: method.tokenType,
        status: 'pending',
        attemptedAt: new Date(),
      };

      const fail = (reason: string): void => {
        attempt.status = 'failed';
        attempt.failureReason = reason;
        attempt.resolvedAt = new Date();
        fallbackAttempts.push(attempt);
      };

      try {
        const expiry = this.checkExpiry(method);
        if (expiry.isExpired) {
          fail(`Payment method expired ${Math.abs(expiry.daysUntilExpiry ?? 0)} days ago`);
          if (chain.stopOnHardDecline) {
            return {
              chainId: chain.id,
              success: false,
              attempt: null,
              fallbackAttempts,
              succeededAtPosition: -1,
              haltedOnHardDecline: true,
            };
          }
          continue;
        }

        const gasCheck = await this.validateGasPrice(chainId, maxGasPriceGwei);
        if (!gasCheck.acceptable) {
          attempt.gasPrice = gasCheck.currentGasPrice;
          fail(`Gas price ${gasCheck.currentGasPrice} gwei exceeds max ${maxGasPriceGwei} gwei`);
          continue;
        }

        const balanceCheck = await this.checkBalance(method, amount, chainId);
        if (!balanceCheck.sufficient) {
          fail(
            `Insufficient ${method.tokenType} balance: have ${balanceCheck.balance}, need ${amount}`
          );
          continue;
        }

        if (
          method.maxSpendPerInterval &&
          ethers.BigNumber.from(amount).gt(method.maxSpendPerInterval)
        ) {
          fail(`Amount ${amount} exceeds max spend per interval ${method.maxSpendPerInterval}`);
          continue;
        }

        attempt.status = 'success';
        attempt.gasPrice = gasCheck.currentGasPrice;
        attempt.resolvedAt = new Date();

        return {
          chainId: chain.id,
          success: true,
          attempt,
          fallbackAttempts,
          succeededAtPosition: position,
          haltedOnHardDecline: false,
        };
      } catch (error) {
        fail(error instanceof Error ? error.message : 'Unknown error');
      }
    }

    return {
      chainId: chain.id,
      success: false,
      attempt: null,
      fallbackAttempts,
      succeededAtPosition: -1,
      haltedOnHardDecline: false,
    };
  }

  // ── Expiry alerts ────────────────────────────────────────────────────

  /**
   * Alerts for methods that have expired or are about to.
   *
   * A method still sitting in an active chain is flagged, because its expiry
   * will break a charge rather than merely retire an unused method.
   */
  buildExpiryAlerts(
    methods: PaymentMethod[],
    chains: FallbackChain[] = []
  ): PaymentMethodExpiryAlert[] {
    const chained = new Set(
      chains.filter((chain) => chain.isActive).flatMap((chain) => chain.methodIds)
    );

    return methods
      .map((method) => {
        const check = this.checkExpiry(method);
        if (check.daysUntilExpiry === null || !method.expiresAt) return null;
        if (!check.isExpired && !check.isExpiringSoon) return null;

        const severity: PaymentMethodExpiryAlert['severity'] = check.isExpired
          ? 'expired'
          : check.daysUntilExpiry <= EXPIRY_CRITICAL_DAYS
            ? 'critical'
            : 'warning';
        const inActiveChain = chained.has(method.id);

        const message = check.isExpired
          ? `${method.label} expired ${Math.abs(check.daysUntilExpiry)} day(s) ago`
          : `${method.label} expires in ${check.daysUntilExpiry} day(s)`;

        return {
          methodId: method.id,
          label: method.label,
          severity,
          daysUntilExpiry: check.daysUntilExpiry,
          expiresAt: method.expiresAt,
          message: inActiveChain ? `${message} and is still in a fallback chain` : message,
          inActiveChain,
        };
      })
      .filter((alert): alert is PaymentMethodExpiryAlert => alert !== null)
      .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  }

  // ── Analytics ────────────────────────────────────────────────────────

  /**
   * Success rates, failure reasons and fallback usage over recorded attempts.
   *
   * `fallbackRate` is the fraction of successful charges that only landed
   * after an earlier method failed — the number that says whether the chain is
   * doing real work or just sitting there.
   */
  computeAnalytics(methods: PaymentMethod[], attempts: PaymentAttempt[]): PaymentMethodAnalytics {
    const byMethodId = new Map(methods.map((method) => [method.id, method]));
    const stats = new Map<string, PaymentMethodStats>();
    const failureCounts = new Map<string, number>();
    const positions = new Map<string, number[]>();

    const ensure = (methodId: string): PaymentMethodStats => {
      let entry = stats.get(methodId);
      if (!entry) {
        entry = {
          methodId,
          label: byMethodId.get(methodId)?.label ?? methodId,
          attempts: 0,
          successes: 0,
          failures: 0,
          successRate: 0,
          volume: 0,
          topFailureReason: null,
          lastUsedAt: byMethodId.get(methodId)?.lastUsedAt ?? null,
          averageChainPosition: 0,
        };
        stats.set(methodId, entry);
      }
      return entry;
    };

    // Attempts for one subscription charge arrive together, so a success that
    // follows failures on the same subscription is a fallback success.
    const bySubscription = new Map<string, PaymentAttempt[]>();
    for (const attempt of attempts) {
      const bucket = bySubscription.get(attempt.subscriptionId) ?? [];
      bucket.push(attempt);
      bySubscription.set(attempt.subscriptionId, bucket);
    }

    let totalSuccesses = 0;
    let totalFailures = 0;
    let fallbackSuccesses = 0;

    for (const bucket of bySubscription.values()) {
      const ordered = [...bucket].sort((a, b) => a.attemptedAt.getTime() - b.attemptedAt.getTime());
      let failuresBefore = 0;

      ordered.forEach((attempt) => {
        const entry = ensure(attempt.paymentMethodId);
        entry.attempts += 1;

        if (attempt.status === 'success') {
          entry.successes += 1;
          entry.volume += Number(attempt.amount) || 0;
          totalSuccesses += 1;
          if (failuresBefore > 0) fallbackSuccesses += 1;
          const seen = positions.get(attempt.paymentMethodId) ?? [];
          seen.push(failuresBefore);
          positions.set(attempt.paymentMethodId, seen);
          failuresBefore = 0;
        } else if (attempt.status === 'failed') {
          entry.failures += 1;
          totalFailures += 1;
          failuresBefore += 1;
          const reason = attempt.failureReason ?? 'Unknown error';
          failureCounts.set(reason, (failureCounts.get(reason) ?? 0) + 1);
        }
      });
    }

    for (const entry of stats.values()) {
      entry.successRate = entry.attempts === 0 ? 0 : entry.successes / entry.attempts;
      const seen = positions.get(entry.methodId) ?? [];
      entry.averageChainPosition =
        seen.length === 0 ? 0 : seen.reduce((sum, value) => sum + value, 0) / seen.length;

      const reasons = attempts
        .filter((a) => a.paymentMethodId === entry.methodId && a.status === 'failed')
        .map((a) => a.failureReason ?? 'Unknown error');
      const tally = new Map<string, number>();
      reasons.forEach((reason) => tally.set(reason, (tally.get(reason) ?? 0) + 1));
      entry.topFailureReason = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }

    const byMethod = [...stats.values()].sort((a, b) => b.attempts - a.attempts);
    const totalAttempts = totalSuccesses + totalFailures;

    return {
      totalAttempts,
      totalSuccesses,
      totalFailures,
      successRate: totalAttempts === 0 ? 0 : totalSuccesses / totalAttempts,
      fallbackRate: totalSuccesses === 0 ? 0 : fallbackSuccesses / totalSuccesses,
      byMethod,
      failureReasons: [...failureCounts.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      mostReliableMethodId:
        byMethod
          .filter((entry) => entry.attempts > 0)
          .sort((a, b) => b.successRate - a.successRate)[0]?.methodId ?? null,
      activeMethods: methods.filter((method) => method.isActive).length,
      expiringMethods: this.getExpiringSoonMethods(methods).length,
    };
  }

  // ── Sharing ──────────────────────────────────────────────────────────

  /**
   * Grant another account use of a payment method.
   *
   * A `viewer` sees the method in listings; a `charger` may also spend from
   * it, bounded by `spendLimit` when one is set.
   */
  createShare(
    method: PaymentMethod,
    granteeId: string,
    role: PaymentMethodShareRole,
    options: { spendLimit?: string; expiresAt?: Date } = {}
  ): PaymentMethodShare {
    if (!granteeId.trim()) {
      throw new PaymentMethodError(
        PaymentMethodErrorCode.INVALID_TOKEN,
        'A share needs a grantee.',
        'Supply the address or account to share with.'
      );
    }
    if (granteeId === method.userId) {
      throw new PaymentMethodError(
        PaymentMethodErrorCode.DUPLICATE,
        'A payment method cannot be shared with its own owner.',
        'Choose a different account.'
      );
    }
    if (!method.isActive) {
      throw new PaymentMethodError(
        PaymentMethodErrorCode.EXPIRED,
        `${method.label} is inactive and cannot be shared.`,
        'Reactivate or replace the method first.'
      );
    }

    return {
      id: `share_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      methodId: method.id,
      granteeId,
      role,
      spendLimit: options.spendLimit ?? null,
      expiresAt: options.expiresAt ?? null,
      createdAt: new Date(),
      revokedAt: null,
    };
  }

  /** True when a live, unexpired share grants `granteeId` the given role. */
  isShareActive(share: PaymentMethodShare, now: Date = new Date()): boolean {
    if (share.revokedAt !== null) return false;
    return share.expiresAt === null || share.expiresAt.getTime() > now.getTime();
  }

  canGranteeCharge(
    shares: PaymentMethodShare[],
    methodId: string,
    granteeId: string,
    amount: string,
    now: Date = new Date()
  ): boolean {
    const share = shares.find(
      (candidate) =>
        candidate.methodId === methodId &&
        candidate.granteeId === granteeId &&
        candidate.role === 'charger' &&
        this.isShareActive(candidate, now)
    );
    if (!share) return false;
    if (share.spendLimit === null) return true;
    return ethers.BigNumber.from(amount).lte(share.spendLimit);
  }

  /** Methods visible to a grantee through their live shares. */
  getSharedMethods(
    methods: PaymentMethod[],
    shares: PaymentMethodShare[],
    granteeId: string,
    now: Date = new Date()
  ): PaymentMethod[] {
    const granted = new Set(
      shares
        .filter((share) => share.granteeId === granteeId && this.isShareActive(share, now))
        .map((share) => share.methodId)
    );
    return methods.filter((method) => granted.has(method.id));
  }
}
