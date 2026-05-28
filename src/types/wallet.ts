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

export enum SupportedChains {
  ETHEREUM = 1,
  POLYGON = 137,
  ARBITRUM = 42161,
  OPTIMISM = 10,
  BASE = 8453,
}

export interface ChainInfo {
  id: SupportedChains;
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
