import { ethers } from 'ethers';
import { Framework, SFError } from '@superfluid-finance/sdk-core';

import { ERC20__factory, getContractAddress } from '../contracts';
import { getEvmRpcUrl } from '../config/evm';
import {
  TIME_CONSTANTS,
  CRYPTO_CONSTANTS,
  CHAIN_IDS,
  ADDRESS_CONSTANTS,
} from '../utils/constants/values';
import {
  PaymentMethod,
  PaymentPriority,
  TokenType,
  PaymentMethodValidationResult,
  PaymentAttempt,
  GasEstimate,
} from '../types/wallet';

// ── Structured error handling ──────────────────────────────────────

import {
  AppError,
  WalletError,
  WalletErrorCode,
  ContractError,
  ContractErrorCode,
  NetworkError,
  NetworkErrorCode,
} from '../errors';

export {
  AppError,
  WalletError,
  WalletErrorCode,
  ContractError,
  ContractErrorCode,
  NetworkError,
  NetworkErrorCode,
};

// ── Error rate tracker ─────────────────────────────────────────────

interface ErrorRecord {
  count: number;
  lastSeen: number;
}

class ErrorRateTracker {
  private readonly counts = new Map<WalletErrorCode, ErrorRecord>();

  record(code: WalletErrorCode): void {
    const existing = this.counts.get(code);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = Date.now();
    } else {
      this.counts.set(code, { count: 1, lastSeen: Date.now() });
    }
  }

  getStats(): Record<string, ErrorRecord> {
    return Object.fromEntries(this.counts.entries());
  }

  reset(): void {
    this.counts.clear();
  }
}

export const errorTracker = new ErrorRateTracker();

export interface WalletConnection {
  address: string;
  chainId: number;
  isConnected: boolean;
  provider?: ethers.providers.Web3Provider;
  /** EIP-1193 provider from WalletConnect / AppKit — required for signing Superfluid txs */
  eip1193Provider?: ethers.providers.ExternalProvider;
}

export interface TokenBalance {
  symbol: string;
  name: string;
  address: string;
  balance: string;
  decimals: number;
  logoURI?: string;
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

/** Result after an on-chain Superfluid CFA stream is created */
export interface SuperfluidStreamResult {
  txHash: string;
  /** Correlates with Superfluid subgraph queries (filter by sender, receiver, token) */
  streamId: string;
}

const SECONDS_PER_MONTH = TIME_CONSTANTS.SECONDS_PER_MONTH;

function isUserRejectedError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false;
  const e = error as { code?: number | string; message?: string };
  if (e.code === 4001 || e.code === 'ACTION_REJECTED') return true;
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  return msg.includes('user rejected') || msg.includes('user denied');
}

function superTokenResolverSymbol(chainId: number, tokenSymbol: string): string {
  const s = tokenSymbol.toUpperCase();
  if (s === 'USDC' || s === 'USDC.E') return 'USDCx';
  if (s === 'MATIC') return 'MATICx';
  if (s === 'ETH') {
    if (chainId === CHAIN_IDS.POLYGON) return 'MATICx';
    return 'ETHx';
  }
  if (s === 'ARB') {
    throw new Error(
      'ARB is not supported as a Superfluid super token on this flow. Use ETH for native streaming on Arbitrum.'
    );
  }
  if (s.endsWith('X')) return s;
  return `${s}x`;
}

function toWalletError(
  error: unknown,
  code: WalletErrorCode,
  userMessage: string,
  recovery?: string
): WalletError {
  errorTracker.record(code);
  // Log full detail for debugging without leaking to the user
  console.error(`[WalletError] ${code}:`, error);
  return new WalletError(code, userMessage, recovery, error);
}

// This is a hook-based service that needs to be used within React components
// For the service layer, we'll create a different approach

export class WalletServiceManager {
  private static instance: WalletServiceManager;
  private connection: WalletConnection | null = null;
  private listeners: ((connection: WalletConnection | null) => void)[] = [];

  static getInstance(): WalletServiceManager {
    if (!WalletServiceManager.instance) {
      WalletServiceManager.instance = new WalletServiceManager();
    }
    return WalletServiceManager.instance;
  }

  async initialize(): Promise<void> {
    try {
      console.log('WalletServiceManager initialized successfully');
    } catch (error) {
      console.error('Failed to initialize WalletServiceManager:', error);
      throw error;
    }
  }

  setConnection(connection: WalletConnection | null): void {
    this.connection = connection;
    this.notifyListeners();
  }

  getConnection(): WalletConnection | null {
    return this.connection;
  }

  addListener(listener: (connection: WalletConnection | null) => void): void {
    this.listeners.push(listener);
  }

  removeListener(listener: (connection: WalletConnection | null) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener(this.connection));
  }

  async disconnectWallet(): Promise<void> {
    try {
      this.connection = null;
      this.notifyListeners();
      console.log('Wallet disconnected');
    } catch (error) {
      console.error('Failed to disconnect wallet:', error);
      throw error;
    }
  }

  async getTokenBalances(address: string, chainId: number): Promise<TokenBalance[]> {
    try {
      const provider = this.getProvider(chainId);
      const balances: TokenBalance[] = [];

      // Get native token balance (ETH, MATIC, etc.)
      const nativeBalance = await provider.getBalance(address);
      const nativeSymbol = this.getNativeSymbol(chainId);

      balances.push({
        symbol: nativeSymbol,
        name: this.getNativeName(chainId),
        address: '0x0000000000000000000000000000000000000000',
        balance: ethers.utils.formatEther(nativeBalance),
        decimals: CRYPTO_CONSTANTS.ETH_DECIMALS,
      });

      // Get USDC balance if on supported chains
      if (
        chainId === CHAIN_IDS.ETHEREUM ||
        chainId === CHAIN_IDS.POLYGON ||
        chainId === CHAIN_IDS.ARBITRUM
      ) {
        const usdcAddress = getContractAddress(chainId, 'usdc');
        if (!usdcAddress) {
          return balances;
        }
        const usdcContract = ERC20__factory.connect(usdcAddress, provider);

        try {
          const usdcBalance = await usdcContract.balanceOf(address);
          balances.push({
            symbol: 'USDC',
            name: 'USD Coin',
            address: usdcAddress,
            balance: ethers.utils.formatUnits(usdcBalance, CRYPTO_CONSTANTS.USDC_DECIMALS),
            decimals: CRYPTO_CONSTANTS.USDC_DECIMALS,
          });
        } catch {
          console.log('USDC not available on this chain');
        }
      }

      return balances;
    } catch (error) {
      throw new NetworkError(
        NetworkErrorCode.RPC_ERROR,
        'Unable to fetch token balances.',
        'Check your network connection and try again.',
        error
      );
    }
  }

  async estimateGas(
    from: string,
    to: string,
    value: string,
    chainId: number,
    userGasLimitOverride?: string
  ): Promise<GasEstimate> {
    let provider: ethers.providers.JsonRpcProvider;
    let gasPrice: ethers.BigNumber;

    try {
      provider = this.getProvider(chainId);
      gasPrice = await this.resolveGasPrice(provider);
    } catch (error) {
      throw new NetworkError(
        NetworkErrorCode.RPC_ERROR,
        'Could not retrieve gas price.',
        'Check your network connection and try again.',
        error
      );
    }

    let gasLimit: ethers.BigNumber;

    if (userGasLimitOverride) {
      gasLimit = ethers.BigNumber.from(userGasLimitOverride);
    } else {
      try {
        const estimated = await provider.estimateGas({
          from,
          to,
          value: ethers.utils.parseEther(value || '0'),
        });
        // Network-specific buffer: higher for Polygon due to congestion variability
        const bufferMultiplier =
          chainId === CHAIN_IDS.POLYGON
            ? CRYPTO_CONSTANTS.POLYGON_GAS_BUFFER_MULTIPLIER
            : CRYPTO_CONSTANTS.DEFAULT_GAS_BUFFER_MULTIPLIER;
        gasLimit = estimated.mul(bufferMultiplier).div(100);
      } catch (err) {
        console.warn('Gas estimation failed, using safe fallback:', err);
        gasLimit = ethers.BigNumber.from(CRYPTO_CONSTANTS.FALLBACK_GAS_LIMIT);
      }
    }

    const estimatedCost = gasPrice.mul(gasLimit);
    return {
      gasLimit: gasLimit.toString(),
      gasPrice: ethers.utils.formatUnits(gasPrice, 'gwei'),
      estimatedCost: ethers.utils.formatEther(estimatedCost),
    };
  }

  private getWalletSigner(): ethers.Signer {
    const conn = this.connection;
    if (!conn?.eip1193Provider) {
      const err = new WalletError(
        WalletErrorCode.NOT_CONNECTED,
        'Wallet is not connected.',
        'Connect your wallet and try again.'
      );
      errorTracker.record(WalletErrorCode.NOT_CONNECTED);
      throw err;
    }
    const web3Provider = new ethers.providers.Web3Provider(conn.eip1193Provider);
    return web3Provider.getSigner();
  }

  private async buildSuperfluidCreateFlowContext(
    tokenSymbol: string,
    amountPerMonth: string,
    recipient: string,
    chainId: number,
    signer: ethers.Signer
  ) {
    const sf = await Framework.create({
      chainId,
      provider: signer.provider!,
    });

    const resolverSymbol = superTokenResolverSymbol(chainId, tokenSymbol);
    const superToken = await sf.loadSuperToken(resolverSymbol);
    const decimals = await superToken.contract.decimals();

    const amountBn = ethers.utils.parseUnits(amountPerMonth, decimals);
    const flowRate = amountBn.div(SECONDS_PER_MONTH);
    if (flowRate.lte(0)) {
      throw new Error(
        'Monthly amount is too small to stream (flow rate rounds to zero per second). Increase the amount.'
      );
    }

    const sender = await signer.getAddress();
    const receiver = ethers.utils.getAddress(recipient);

    if (sender.toLowerCase() === receiver.toLowerCase()) {
      throw new Error('Recipient must be a different address than your connected wallet.');
    }

    const createOp = sf.cfaV1.createFlow({
      superToken: superToken.address,
      sender,
      receiver,
      flowRate: flowRate.toString(),
    });

    return { createOp, superTokenAddress: superToken.address, sender, receiver, flowRate };
  }

  /**
   * Estimates gas for creating a CFA stream (monthly amount → per-second flow rate).
   * Call while the wallet is on `chainId`.
   */
  async estimateSuperfluidCreateFlow(
    tokenSymbol: string,
    amountPerMonth: string,
    recipient: string,
    chainId: number
  ): Promise<GasEstimate> {
    const signer = this.getWalletSigner();
    try {
      const network = await signer.provider!.getNetwork();
      if (network.chainId !== chainId) {
        throw new WalletError(
          WalletErrorCode.NETWORK_MISMATCH,
          `Wallet network (${network.chainId}) does not match selected chain (${chainId}). Switch network in your wallet.`
        );
      }

      const { createOp } = await this.buildSuperfluidCreateFlowContext(
        tokenSymbol,
        amountPerMonth,
        recipient,
        chainId,
        signer
      );

      const populated = await createOp.getPopulatedTransactionRequest(signer, 1.2);
      const gasLimit = populated.gasLimit;
      if (!gasLimit) {
        throw new ContractError(
          ContractErrorCode.EXECUTION_FAILED,
          'Could not estimate gas for Superfluid createFlow'
        );
      }

      const gasPrice = await signer.provider!.getGasPrice();
      const estimatedCostWei = gasPrice.mul(gasLimit);

      return {
        gasLimit: gasLimit.toString(),
        gasPrice: ethers.utils.formatUnits(gasPrice, 'gwei'),
        estimatedCost: ethers.utils.formatEther(estimatedCostWei),
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new ContractError(
        ContractErrorCode.EXECUTION_FAILED,
        'Superfluid gas estimation failed.',
        'Check your token balance and try again.',
        error
      );
    }
  }

  async createSuperfluidStream(
    tokenSymbol: string,
    amountPerMonth: string,
    recipient: string,
    chainId: number
  ): Promise<SuperfluidStreamResult> {
    const signer = this.getWalletSigner();

    try {
      const network = await signer.provider!.getNetwork();
      if (network.chainId !== chainId) {
        throw new Error(
          `Wallet network (${network.chainId}) does not match selected chain (${chainId}). Switch network in your wallet.`
        );
      }

      const { createOp, superTokenAddress, sender, receiver } =
        await this.buildSuperfluidCreateFlowContext(
          tokenSymbol,
          amountPerMonth,
          recipient,
          chainId,
          signer
        );

      const txResponse = await createOp.exec(signer);
      const receipt = await txResponse.wait();

      if (!receipt?.transactionHash) {
        throw new Error('Transaction mined without a hash');
      }

      const streamId = `${superTokenAddress.toLowerCase()}:${sender.toLowerCase()}:${receiver.toLowerCase()}`;

      return {
        txHash: receipt.transactionHash,
        streamId,
      };
    } catch (error) {
      if (isUserRejectedError(error)) {
        errorTracker.record(WalletErrorCode.USER_REJECTED);
        throw new WalletError(
          WalletErrorCode.USER_REJECTED,
          'Transaction was rejected in your wallet.',
          'Open your wallet and approve the transaction to continue.'
        );
      }
      throw new ContractError(
        ContractErrorCode.EXECUTION_FAILED,
        'Stream creation failed.',
        'Check your token balance and try again.',
        error
      );
    }
  }

  async createSablierStream(
    token: string,
    amount: string,
    startTime: number,
    stopTime: number,
    recipient: string,
    chainId: number
  ): Promise<string> {
    try {
      const signer = this.getWalletSigner();
      const network = await signer.provider!.getNetwork();
      if (network.chainId !== chainId) {
        throw new Error(
          `Wallet network (${network.chainId}) does not match selected chain (${chainId}). Switch network in your wallet.`
        );
      }

      // 1. Get Token Decimals & Parse Amount
      const erc20Abi = [
        'function decimals() view returns (uint8)',
        'function approve(address spender, uint256 amount) returns (bool)',
        'function allowance(address owner, address spender) view returns (uint256)',
      ];
      const erc20 = new ethers.Contract(token, erc20Abi, signer);
      const decimals = await erc20.decimals();
      const amountBn = ethers.utils.parseUnits(amount, decimals);

      // Sablier V2 LockupLinear is consistently deployed at this address across major EVM networks
      const SABLIER_V2_LOCKUP_LINEAR = ADDRESS_CONSTANTS.SABLIER_V2_LOCKUP_LINEAR;

      // 2. Ensure Allowance (approve exact amount if insufficient)
      const owner = await signer.getAddress();
      const currentAllowance: ethers.BigNumber = await erc20.allowance(
        owner,
        SABLIER_V2_LOCKUP_LINEAR
      );
      if (currentAllowance.lt(amountBn)) {
        const txApprove = await erc20.approve(SABLIER_V2_LOCKUP_LINEAR, amountBn);
        await txApprove.wait();
      }

      // 3. Create the Sablier Stream
      const abi = [
        'function createWithDurations(tuple(address sender, address recipient, uint128 totalAmount, address asset, bool cancelable, bool transferable, tuple(uint40 cliff, uint40 total) durations, address broker) params) external returns (uint256 streamId)',
      ];

      const sablierContract = new ethers.Contract(SABLIER_V2_LOCKUP_LINEAR, abi, signer);
      const sender = await signer.getAddress();

      // Calculate duration in seconds
      const totalDuration = Math.floor((stopTime - startTime) / 1000);

      const params = {
        sender: sender,
        recipient: recipient,
        totalAmount: amountBn,
        asset: token,
        cancelable: true,
        transferable: true,
        durations: {
          cliff: 0,
          total: totalDuration,
        },
        broker: ADDRESS_CONSTANTS.ZERO_ADDRESS,
      };

      const txCreate = await sablierContract.createWithDurations(params);
      const receipt = await txCreate.wait();

      if (!receipt?.transactionHash) {
        throw new Error('Transaction mined without a hash');
      }

      return receipt.transactionHash;
    } catch (error) {
      if (isUserRejectedError(error)) {
        errorTracker.record(WalletErrorCode.USER_REJECTED);
        throw new WalletError(
          WalletErrorCode.USER_REJECTED,
          'Transaction was rejected in your wallet.',
          'Open your wallet and approve the transaction to continue.'
        );
      }
      throw new ContractError(
        ContractErrorCode.EXECUTION_FAILED,
        'Stream creation failed.',
        'Check your token balance and allowance, then try again.',
        error
      );
    }
  }

  /**
   * Returns the ERC20 allowance that `owner` granted to `spender`.
   */
  async getErc20Allowance(
    token: string,
    owner: string,
    spender: string,
    chainId: number
  ): Promise<ethers.BigNumber> {
    const provider = this.getProvider(chainId);
    const erc20Abi = ['function allowance(address owner, address spender) view returns (uint256)'];
    const erc20 = new ethers.Contract(token, erc20Abi, provider);
    return erc20.allowance(owner, spender);
  }

  /**
   * Estimates gas for approving an ERC20 allowance to `spender`.
   */
  async estimateApproveGas(
    token: string,
    spender: string,
    amount: ethers.BigNumberish,
    chainId: number
  ): Promise<GasEstimate> {
    const provider = this.getProvider(chainId);
    const gasPrice = await this.resolveGasPrice(provider);

    const erc20Abi = ['function approve(address spender, uint256 amount) returns (bool)'];
    const conn = this.connection;
    if (!conn?.eip1193Provider) {
      const err = new WalletError(
        WalletErrorCode.NOT_CONNECTED,
        'Wallet is not connected.',
        'Connect your wallet and try again.'
      );
      errorTracker.record(WalletErrorCode.NOT_CONNECTED);
      throw err;
    }
    const web3Provider = new ethers.providers.Web3Provider(conn.eip1193Provider);
    const signer = web3Provider.getSigner();
    const erc20WithSigner = new ethers.Contract(token, erc20Abi, signer);

    let gasLimit: ethers.BigNumber;
    try {
      const estimated = await erc20WithSigner.estimateGas.approve(spender, amount);
      const bufferMultiplier =
        chainId === CHAIN_IDS.POLYGON
          ? CRYPTO_CONSTANTS.POLYGON_GAS_BUFFER_MULTIPLIER
          : CRYPTO_CONSTANTS.DEFAULT_GAS_BUFFER_MULTIPLIER;
      gasLimit = estimated.mul(bufferMultiplier).div(100);
    } catch (err) {
      console.warn('Approve gas estimation failed, using fallback:', err);
      gasLimit = ethers.BigNumber.from(CRYPTO_CONSTANTS.FALLBACK_GAS_LIMIT);
    }

    const estimatedCost = gasPrice.mul(gasLimit);
    return {
      gasLimit: gasLimit.toString(),
      gasPrice: ethers.utils.formatUnits(gasPrice, 'gwei'),
      estimatedCost: ethers.utils.formatEther(estimatedCost),
    };
  }

  /**
   * Performs an ERC20 approve for `spender` and waits for mining.
   * Returns transaction hash.
   */
  async approveErc20(token: string, spender: string, amount: ethers.BigNumberish): Promise<string> {
    const signer = this.getWalletSigner();
    const erc20Abi = ['function approve(address spender, uint256 amount) returns (bool)'];
    const erc20 = new ethers.Contract(token, erc20Abi, signer);
    try {
      const tx = await erc20.approve(spender, amount);
      const receipt = await tx.wait();
      if (!receipt?.transactionHash) {
        throw new Error('Approval transaction mined without a hash');
      }
      return receipt.transactionHash;
    } catch (error) {
      if (isUserRejectedError(error)) {
        errorTracker.record(WalletErrorCode.USER_REJECTED);
        throw new WalletError(
          WalletErrorCode.USER_REJECTED,
          'Approval was rejected in your wallet.',
          'Open your wallet and approve the request to continue.'
        );
      }
      throw new ContractError(
        ContractErrorCode.EXECUTION_FAILED,
        'Token approval failed.',
        'Check your wallet connection and try again.',
        error
      );
    }
  }

  private getProvider(chainId: number): ethers.providers.JsonRpcProvider {
    return new ethers.providers.JsonRpcProvider(getEvmRpcUrl(chainId));
  }

  private async resolveGasPrice(
    provider: ethers.providers.JsonRpcProvider
  ): Promise<ethers.BigNumber> {
    if (typeof provider.getFeeData === 'function') {
      const feeData = await provider.getFeeData();
      return feeData.maxFeePerGas ?? feeData.gasPrice ?? ethers.BigNumber.from(0);
    }

    if (typeof provider.getGasPrice === 'function') {
      return provider.getGasPrice();
    }

    return ethers.BigNumber.from(0);
  }

  private getNativeSymbol(chainId: number): string {
    const symbols: Record<number, string> = {
      [CHAIN_IDS.ETHEREUM]: 'ETH',
      [CHAIN_IDS.POLYGON]: 'MATIC',
      [CHAIN_IDS.ARBITRUM]: 'ETH',
    };
    return symbols[chainId] || 'ETH';
  }

  private getNativeName(chainId: number): string {
    const names: Record<number, string> = {
      [CHAIN_IDS.ETHEREUM]: 'Ethereum',
      [CHAIN_IDS.POLYGON]: 'Polygon',
      [CHAIN_IDS.ARBITRUM]: 'Arbitrum',
    };
    return names[chainId] || 'Ethereum';
  }

  isConnected(): boolean {
    return this.connection?.isConnected || false;
  }
}

// ── Payment method management ───────────────────────────────────────

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

export class PaymentMethodError extends AppError {
  constructor(
    code: PaymentMethodErrorCode | string,
    userMessage: string,
    recovery?: string,
    cause?: unknown
  ) {
    super(code, userMessage, recovery, cause);
    this.name = 'PaymentMethodError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const MAX_PAYMENT_METHODS_PER_USER = 10;
const EXPIRY_WARNING_DAYS = 30;
const TOKEN_TYPE_TO_NATIVE_SYMBOL: Record<number, Record<TokenType, string>> = {
  [CHAIN_IDS.ETHEREUM]: { XLM: '', USDC: 'USDC', ETH: 'ETH', NATIVE: 'ETH', MATIC: '', ARB: '' },
  [CHAIN_IDS.POLYGON]: { XLM: '', USDC: 'USDC', ETH: 'ETH', NATIVE: 'MATIC', MATIC: 'MATIC', ARB: '' },
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
  private readonly walletManager: WalletServiceManager;

  static getInstance(): PaymentMethodService {
    if (!PaymentMethodService.instance) {
      PaymentMethodService.instance = new PaymentMethodService();
    }
    return PaymentMethodService.instance;
  }

  private constructor() {
    this.walletManager = WalletServiceManager.getInstance();
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

    if (!data.maxSpendPerInterval || isNaN(Number(data.maxSpendPerInterval)) || Number(data.maxSpendPerInterval) <= 0) {
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
    const conn = this.walletManager.getConnection();
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
      const erc20Abi = ['function decimals() view returns (uint8)', 'function symbol() view returns (string)'];
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
    return methods.filter((m) => m.priority === PaymentPriority.PRIMARY && m.isActive && m.isVerified);
  }

  getBackupMethods(methods: PaymentMethod[]): PaymentMethod[] {
    return methods.filter((m) => m.priority === PaymentPriority.BACKUP && m.isActive && m.isVerified);
  }

  getFallbackMethods(methods: PaymentMethod[]): PaymentMethod[] {
    return methods.filter((m) => m.priority === PaymentPriority.FALLBACK && m.isActive && m.isVerified);
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
      const conn = this.walletManager.getConnection();
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

      const required = ethers.utils.parseUnits(requiredAmount, method.tokenType === TokenType.USDC ? 6 : 18);
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

        if (method.maxSpendPerInterval && ethers.BigNumber.from(amount).gt(method.maxSpendPerInterval)) {
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

// Export singleton instance
export const walletServiceManager = WalletServiceManager.getInstance();
export const paymentMethodService = PaymentMethodService.getInstance();
export default walletServiceManager;
