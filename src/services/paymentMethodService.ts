import { ethers } from 'ethers';

import { getEvmRpcUrl } from '../config/evm';
import { CHAIN_IDS } from '../utils/constants/values';
import {
  PaymentMethod,
  PaymentPriority,
  TokenType,
  PaymentMethodValidationResult,
  PaymentAttempt,
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
}
