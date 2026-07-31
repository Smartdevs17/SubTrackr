export interface Wallet {
  address: string;
  chainId: number;
  isConnected: boolean;
  balance: string;
  tokens: TokenBalance[];
}

export interface TokenBalance {
  symbol: string;
  name: string;
  address: string;
  balance: string;
  decimals: number;
  logoURI?: string;
}

export interface CryptoStream {
  id: string;
  subscriptionId: string;
  token: string;
  amount: number;
  flowRate: string;
  startDate: Date;
  endDate?: Date;
  isActive: boolean;
  protocol: 'superfluid' | 'sablier';
  streamId?: string;
}

export interface StreamSetup {
  token: string;
  amount: number;
  flowRate: string;
  startDate: Date;
  endDate?: Date;
  protocol: 'superfluid' | 'sablier';
}

export interface GasEstimate {
  gasLimit: string;
  gasPrice: string;
  estimatedCost: string;
}

export interface Transaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  gasUsed: string;
  gasPrice: string;
  status: 'pending' | 'confirmed' | 'failed';
  timestamp: Date;
}

export enum ChainType {
  EVM = 'evm',
  STELLAR = 'stellar',
}

export enum SupportedChains {
  ETHEREUM = 1,
  POLYGON = 137,
  ARBITRUM = 42161,
  OPTIMISM = 10,
  BASE = 8453,
  STELLAR = 0x8000,
}

export interface StellarChainInfo {
  id: number;
  name: string;
  networkPassphrase: string;
  horizonUrl: string;
  sorobanRpcUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

export interface ChainInfo {
  id: SupportedChains;
  chainType: ChainType;
  name: string;
  rpcUrl: string;
  blockExplorer: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

export enum TokenType {
  XLM = 'XLM',
  USDC = 'USDC',
  ETH = 'ETH',
  NATIVE = 'NATIVE',
  MATIC = 'MATIC',
  ARB = 'ARB',
}

export enum PaymentPriority {
  PRIMARY = 'primary',
  BACKUP = 'backup',
  FALLBACK = 'fallback',
}

export interface PaymentMethod {
  id: string;
  userId: string;
  tokenType: TokenType;
  tokenAddress: string;
  chainId: number;
  label: string;
  priority: PaymentPriority;
  maxSpendPerInterval: string;
  isVerified: boolean;
  isActive: boolean;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, string>;
}

export interface PaymentMethodFormData {
  tokenType: TokenType;
  tokenAddress: string;
  chainId: number;
  label: string;
  priority: PaymentPriority;
  maxSpendPerInterval: string;
}

export interface PaymentAttempt {
  id: string;
  paymentMethodId: string;
  subscriptionId: string;
  amount: string;
  tokenType: TokenType;
  status: 'pending' | 'success' | 'failed' | 'fallback_triggered';
  failureReason?: string;
  gasPrice?: string;
  gasUsed?: string;
  attemptedAt: Date;
  resolvedAt?: Date;
}

export interface PaymentMethodValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  requiresVerification: boolean;
  estimatedGas: GasEstimate | null;
}

// ── Fallback chains ────────────────────────────────────────────────────
//
// A chain is an explicit, ordered list of payment methods to try for a
// charge. It replaces implicit priority ordering when a merchant wants a
// specific route — "card, then USDC, then the treasury wallet" — and can be
// scoped to one subscription.

export interface FallbackChain {
  id: string;
  name: string;
  /** Payment method ids, tried in this order. */
  methodIds: string[];
  /** `null` applies the chain to every subscription. */
  subscriptionId: string | null;
  /** Ceiling on methods tried in one charge; 0 means try the whole chain. */
  maxAttempts: number;
  /**
   * Stop the whole chain on a hard decline (an expired or deactivated method)
   * rather than falling through to the next entry.
   */
  stopOnHardDecline: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FallbackChainValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/** Severity of an approaching or elapsed payment method expiry. */
export type ExpiryAlertSeverity = 'expired' | 'critical' | 'warning';

export interface PaymentMethodExpiryAlert {
  methodId: string;
  label: string;
  severity: ExpiryAlertSeverity;
  /** Negative once the method has expired. */
  daysUntilExpiry: number;
  expiresAt: Date;
  message: string;
  /** True when the method still appears in an active fallback chain. */
  inActiveChain: boolean;
}

/** Who a payment method has been shared with, and what they may do. */
export type PaymentMethodShareRole = 'viewer' | 'charger';

export interface PaymentMethodShare {
  id: string;
  methodId: string;
  /** Address or user id the method is shared with. */
  granteeId: string;
  role: PaymentMethodShareRole;
  /** Ceiling on what the grantee may spend per interval, `null` to inherit. */
  spendLimit: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

/** Per-method success and failure counters. */
export interface PaymentMethodStats {
  methodId: string;
  label: string;
  attempts: number;
  successes: number;
  failures: number;
  /** `successes / attempts`, 0-1. */
  successRate: number;
  /** Total value successfully charged through this method. */
  volume: number;
  /** Most common failure reason, `null` when nothing failed. */
  topFailureReason: string | null;
  lastUsedAt: Date | null;
  /** Position in the fallback chain the method usually succeeds from. */
  averageChainPosition: number;
}

export interface PaymentMethodAnalytics {
  totalAttempts: number;
  totalSuccesses: number;
  totalFailures: number;
  successRate: number;
  /** Fraction of successful charges that needed a fallback, 0-1. */
  fallbackRate: number;
  byMethod: PaymentMethodStats[];
  failureReasons: { reason: string; count: number }[];
  /** Method id with the highest success rate over at least one attempt. */
  mostReliableMethodId: string | null;
  activeMethods: number;
  expiringMethods: number;
}
