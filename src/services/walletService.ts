import { ethers } from 'ethers';
import { Framework, SFError } from '@superfluid-finance/sdk-core';

import { logger } from './logging';
import { ERC20__factory, getContractAddress } from '../contracts';
import { getEvmRpcUrl, getEvmRpcUrls } from '../config/evm';
import { getOrCreateResilientProvider } from './rpcProvider';
import {
  TIME_CONSTANTS,
  CRYPTO_CONSTANTS,
  CHAIN_IDS,
  ADDRESS_CONSTANTS,
} from '../utils/constants/values';
import {
  GasEstimate,
} from '../types/wallet';
import { PaymentMethodService } from './paymentMethodService';

// ── Structured error handling ──────────────────────────────────────

export enum WalletErrorCode {
  NOT_CONNECTED = 'WALLET_NOT_CONNECTED',
  USER_REJECTED = 'USER_REJECTED',
  NETWORK_MISMATCH = 'NETWORK_MISMATCH',
  BALANCE_FETCH_FAILED = 'BALANCE_FETCH_FAILED',
  GAS_ESTIMATION_FAILED = 'GAS_ESTIMATION_FAILED',
  STREAM_CREATION_FAILED = 'STREAM_CREATION_FAILED',
  APPROVAL_FAILED = 'APPROVAL_FAILED',
  INVALID_PARAMS = 'INVALID_PARAMS',
  UNKNOWN = 'UNKNOWN',
}

export class WalletError extends Error {
  readonly code: WalletErrorCode;
  readonly userMessage: string;
  readonly recovery?: string;

  constructor(
    code: WalletErrorCode,
    userMessage: string,
    recovery?: string,
    cause?: unknown
  ) {
    super(userMessage);
    this.name = 'WalletError';
    this.code = code;
    this.userMessage = userMessage;
    this.recovery = recovery;
    // Preserve original stack if available
    if (cause instanceof Error && cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

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

/** Balances for one chain within a multi-chain fetch, or why that chain failed. */
export interface ChainBalanceResult {
  chainId: number;
  balances: TokenBalance[];
  error?: string;
}

export interface MultiChainBalances {
  address: string;
  results: ChainBalanceResult[];
  /** Chains whose balances could not be read; their results are empty. */
  failedChainIds: number[];
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
  logger.error(`WalletError ${code}`, { error, code, userMessage, recovery });
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
      logger.info('WalletServiceManager initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize WalletServiceManager', { error });
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
      logger.info('Wallet disconnected');
    } catch (error) {
      logger.error('Failed to disconnect wallet', { error });
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
          logger.warn('USDC not available on this chain', { chainId });
        }
      }

      return balances;
    } catch (error) {
      throw toWalletError(
        error,
        WalletErrorCode.BALANCE_FETCH_FAILED,
        'Unable to fetch token balances.',
        'Check your network connection and try again.'
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
      throw toWalletError(
        error,
        WalletErrorCode.GAS_ESTIMATION_FAILED,
        'Could not retrieve gas price.',
        'Check your network connection and try again.'
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
        logger.warn('Gas estimation failed, using safe fallback', { error: err });
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
    const network = await signer.provider!.getNetwork();
    if (network.chainId !== chainId) {
      throw new Error(
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
      throw new Error('Could not estimate gas for Superfluid createFlow');
    }

    const gasPrice = await signer.provider!.getGasPrice();
    const estimatedCostWei = gasPrice.mul(gasLimit);

    return {
      gasLimit: gasLimit.toString(),
      gasPrice: ethers.utils.formatUnits(gasPrice, 'gwei'),
      estimatedCost: ethers.utils.formatEther(estimatedCostWei),
    };
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
      throw toWalletError(
        error,
        WalletErrorCode.STREAM_CREATION_FAILED,
        'Stream creation failed.',
        'Check your token balance and try again.'
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
      throw toWalletError(
        error,
        WalletErrorCode.STREAM_CREATION_FAILED,
        'Stream creation failed.',
        'Check your token balance and allowance, then try again.'
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
      logger.warn('Approve gas estimation failed, using fallback', { error: err });
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
      throw toWalletError(
        error,
        WalletErrorCode.APPROVAL_FAILED,
        'Token approval failed.',
        'Check your wallet connection and try again.'
      );
    }
  }

  private getProvider(chainId: number): ethers.providers.JsonRpcProvider {
    // Use resilient provider with timeout + circuit breaker + multi-URL fallback.
    // Falls back to getEvmRpcUrl for chains not in EVM_RPC_URLS (unknown chains).
    let urls: string[];
    try {
      urls = getEvmRpcUrls(chainId);
    } catch {
      urls = [getEvmRpcUrl(chainId)];
    }
    return getOrCreateResilientProvider(chainId, urls) as unknown as ethers.providers.JsonRpcProvider;
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

  /**
   * Fetches balances across several chains at once, for the unified
   * multi-chain view (see `multiChainSubscriptionService`).
   *
   * One unreachable chain must not blank the whole view, so failures are
   * reported per chain instead of rejecting the call. Requests run in parallel
   * because a serial walk over a handful of RPCs is the slowest thing on the
   * balances screen.
   */
  async getBalancesAcrossChains(
    address: string,
    chainIds: number[]
  ): Promise<MultiChainBalances> {
    const settled = await Promise.all(
      chainIds.map(async (chainId): Promise<ChainBalanceResult> => {
        try {
          return { chainId, balances: await this.getTokenBalances(address, chainId) };
        } catch (error) {
          return {
            chainId,
            balances: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      })
    );

    return {
      address,
      results: settled,
      failedChainIds: settled.filter((r) => r.error !== undefined).map((r) => r.chainId),
    };
  }

  /**
   * Total holdings of one token across chains, keyed by chain id.
   *
   * Balances stay per chain rather than being summed: the same symbol on two
   * chains is not fungible, and a single figure would imply it is.
   */
  static totalsBySymbol(
    balances: MultiChainBalances,
    symbol: string
  ): Record<number, number> {
    const wanted = symbol.toUpperCase();
    const totals: Record<number, number> = {};
    for (const result of balances.results) {
      const match = result.balances.find((b) => b.symbol.toUpperCase() === wanted);
      if (match) {
        const parsed = Number(match.balance);
        totals[result.chainId] = Number.isFinite(parsed) ? parsed : 0;
      }
    }
    return totals;
  }
}

// ── Payment method management ───────────────────────────────────────
//
// All payment-method types, errors, and the service class live in
// paymentMethodService.ts.  Re-export them from here so existing imports of
// walletService keep working unchanged.

export {
  PaymentMethodErrorCode,
  PaymentMethodError,
  PaymentMethodService,
} from './paymentMethodService';
export type {
  PaymentMethodExpiryCheck,
  ChainPaymentResult,
} from './paymentMethodService';

// Export singleton instances
export const walletServiceManager = WalletServiceManager.getInstance();
export const paymentMethodService = PaymentMethodService.getInstance();
export default walletServiceManager;

// ═══════════════════════════════════════════════════════════════════════════
// Issue #922 — Payment Method Management with Fallback Chains
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Health status of a single payment method in a fallback chain.
 */
export interface PaymentMethodHealth {
  methodId: string;
  /** Fraction of recent attempts that succeeded (0–1). */
  successRate: number;
  /** Average latency of the last N authorizations in ms. */
  avgLatencyMs: number;
  /** Whether the method is currently considered healthy. */
  healthy: boolean;
  /** ISO-8601 timestamp of the last successful authorization. */
  lastSuccessAt: string | null;
  /** Consecutive failure count since the last success. */
  consecutiveFailures: number;
}

/**
 * Snapshot of the health of every method in a fallback chain.
 */
export interface FallbackChainHealthSnapshot {
  chainId: string;
  checkedAt: string;
  methods: PaymentMethodHealth[];
  /** Overall chain health: green when all methods are healthy. */
  overallStatus: 'green' | 'yellow' | 'red';
}

/**
 * Policy that governs automatic rotation of the primary payment method
 * within a fallback chain.
 */
export interface PaymentMethodRotationPolicy {
  chainId: string;
  /** Rotate if the primary method fails this many times in a row. */
  failureThreshold: number;
  /** How long (ms) to keep the rotated method as primary before reverting. */
  cooldownMs: number;
  /** Whether rotation is enabled. */
  enabled: boolean;
  /** Method that is currently promoted due to rotation (null = original). */
  activePromotedMethodId: string | null;
  promotedAt: string | null;
}

/**
 * Result of a smart fallback selection run.
 */
export interface SmartFallbackSelection {
  selectedMethodId: string;
  reasoning: string;
  fallbackOrder: string[];
  estimatedSuccessRate: number;
}

/**
 * Monitors the health of payment methods across all fallback chains and
 * applies automatic rotation policies.
 *
 * Usage:
 *   const monitor = FallbackChainHealthMonitor.getInstance();
 *   const snapshot = monitor.snapshotChainHealth(chainId, methods, attempts);
 *   monitor.applyRotationPolicy(policy, snapshot);
 */
export class FallbackChainHealthMonitor {
  private static instance: FallbackChainHealthMonitor;
  private readonly rotationPolicies = new Map<string, PaymentMethodRotationPolicy>();

  static getInstance(): FallbackChainHealthMonitor {
    if (!FallbackChainHealthMonitor.instance) {
      FallbackChainHealthMonitor.instance = new FallbackChainHealthMonitor();
    }
    return FallbackChainHealthMonitor.instance;
  }

  /**
   * Compute health for every method referenced by the given chain.
   *
   * @param chainId        Identifier of the fallback chain.
   * @param methodIds      Ordered method IDs in the chain.
   * @param recentAttempts Recent payment attempts (all methods, newest first).
   * @param windowMs       Look-back window (default 24 h).
   */
  snapshotChainHealth(
    chainId: string,
    methodIds: string[],
    recentAttempts: Array<{
      paymentMethodId: string;
      success: boolean;
      timestamp: Date;
      latencyMs?: number;
    }>,
    windowMs = 86_400_000
  ): FallbackChainHealthSnapshot {
    const cutoff = Date.now() - windowMs;
    const now = new Date().toISOString();

    const methodHealths: PaymentMethodHealth[] = methodIds.map((methodId) => {
      const relevant = recentAttempts.filter(
        (a) => a.paymentMethodId === methodId && a.timestamp.getTime() >= cutoff
      );

      const total = relevant.length;
      const successes = relevant.filter((a) => a.success).length;
      const successRate = total === 0 ? 1 : successes / total;

      const latencies = relevant.filter((a) => a.latencyMs != null).map((a) => a.latencyMs!);
      const avgLatencyMs =
        latencies.length === 0 ? 0 : latencies.reduce((s, l) => s + l, 0) / latencies.length;

      // Count consecutive failures from the newest attempt backwards.
      let consecutiveFailures = 0;
      for (const attempt of relevant) {
        if (!attempt.success) {
          consecutiveFailures += 1;
        } else {
          break;
        }
      }

      const lastSuccess = relevant.find((a) => a.success);
      const lastSuccessAt = lastSuccess ? lastSuccess.timestamp.toISOString() : null;

      // Unhealthy when success rate < 50 % or 3+ consecutive failures.
      const healthy = successRate >= 0.5 && consecutiveFailures < 3;

      return {
        methodId,
        successRate,
        avgLatencyMs,
        healthy,
        lastSuccessAt,
        consecutiveFailures,
      };
    });

    const healthyCount = methodHealths.filter((m) => m.healthy).length;
    const overallStatus: FallbackChainHealthSnapshot['overallStatus'] =
      healthyCount === methodHealths.length
        ? 'green'
        : healthyCount > 0
          ? 'yellow'
          : 'red';

    return { chainId, checkedAt: now, methods: methodHealths, overallStatus };
  }

  /**
   * Register or update a rotation policy for a chain.
   */
  setRotationPolicy(policy: PaymentMethodRotationPolicy): void {
    this.rotationPolicies.set(policy.chainId, { ...policy });
  }

  getRotationPolicy(chainId: string): PaymentMethodRotationPolicy | null {
    return this.rotationPolicies.get(chainId) ?? null;
  }

  /**
   * Apply the rotation policy for a chain given its current health snapshot.
   * Returns the (possibly updated) policy — callers should persist any changes.
   */
  applyRotationPolicy(
    policy: PaymentMethodRotationPolicy,
    snapshot: FallbackChainHealthSnapshot
  ): PaymentMethodRotationPolicy {
    if (!policy.enabled) return policy;

    const updated = { ...policy };

    // Check if the cooldown has expired and we should revert the promoted method.
    if (updated.activePromotedMethodId && updated.promotedAt) {
      const promotedMs = Date.now() - new Date(updated.promotedAt).getTime();
      if (promotedMs >= updated.cooldownMs) {
        updated.activePromotedMethodId = null;
        updated.promotedAt = null;
      }
    }

    // Find the primary method health (first in chain).
    const primaryHealth = snapshot.methods[0];
    if (!primaryHealth) return updated;

    // Trigger rotation if primary is unhealthy beyond the threshold.
    if (
      primaryHealth.consecutiveFailures >= policy.failureThreshold &&
      updated.activePromotedMethodId === null
    ) {
      // Promote the first healthy backup.
      const backup = snapshot.methods.slice(1).find((m) => m.healthy);
      if (backup) {
        updated.activePromotedMethodId = backup.methodId;
        updated.promotedAt = new Date().toISOString();
        this.rotationPolicies.set(policy.chainId, updated);
      }
    }

    return updated;
  }
}

/**
 * Selects the best fallback method based on historical success rates,
 * current health and network conditions.
 */
export class SmartFallbackSelector {
  private static instance: SmartFallbackSelector;
  private readonly monitor = FallbackChainHealthMonitor.getInstance();

  static getInstance(): SmartFallbackSelector {
    if (!SmartFallbackSelector.instance) {
      SmartFallbackSelector.instance = new SmartFallbackSelector();
    }
    return SmartFallbackSelector.instance;
  }

  /**
   * Returns the recommended method order for a given chain execution.
   *
   * @param chainMethodIds  Original ordered method IDs in the chain.
   * @param healthSnapshot  Current health for each method.
   * @param rotationPolicy  Optional active rotation policy.
   */
  selectFallbackOrder(
    chainMethodIds: string[],
    healthSnapshot: FallbackChainHealthSnapshot,
    rotationPolicy?: PaymentMethodRotationPolicy | null
  ): SmartFallbackSelection {
    // Build a health map for O(1) lookup.
    const healthMap = new Map(healthSnapshot.methods.map((m) => [m.methodId, m]));

    // Start from the original order.
    let ordered = [...chainMethodIds];

    // Apply rotation: if a promoted method exists, push it to the front.
    if (rotationPolicy?.activePromotedMethodId) {
      const promoted = rotationPolicy.activePromotedMethodId;
      ordered = [promoted, ...ordered.filter((id) => id !== promoted)];
    }

    // Re-rank: unhealthy methods sink to the back while preserving relative
    // order among healthy and unhealthy groups.
    const healthy: string[] = [];
    const unhealthy: string[] = [];
    for (const id of ordered) {
      const h = healthMap.get(id);
      if (h && !h.healthy) {
        unhealthy.push(id);
      } else {
        healthy.push(id);
      }
    }

    const fallbackOrder = [...healthy, ...unhealthy];
    const selectedMethodId = fallbackOrder[0];
    const selectedHealth = healthMap.get(selectedMethodId);
    const estimatedSuccessRate = selectedHealth?.successRate ?? 0.9;

    let reasoning = `Selected method ${selectedMethodId}`;
    if (rotationPolicy?.activePromotedMethodId === selectedMethodId) {
      reasoning += ' (rotation policy active)';
    } else if (selectedHealth && !selectedHealth.healthy) {
      reasoning += ' (all methods degraded; using least-worst option)';
    } else {
      reasoning += ' (highest health score)';
    }

    return { selectedMethodId, reasoning, fallbackOrder, estimatedSuccessRate };
  }
}

/**
 * Simple diagnostic utility: builds a human-readable summary of chain
 * health for display in the PaymentMethodsScreen.
 */
export function buildFallbackChainDiagnosticReport(
  snapshot: FallbackChainHealthSnapshot,
  selection: SmartFallbackSelection
): string {
  const lines: string[] = [
    `Chain: ${snapshot.chainId}  |  Status: ${snapshot.overallStatus.toUpperCase()}`,
    `Checked: ${new Date(snapshot.checkedAt).toLocaleString()}`,
    '',
    'Method health:',
  ];

  for (const m of snapshot.methods) {
    const status = m.healthy ? '✅' : '⚠️ ';
    const rate = `${(m.successRate * 100).toFixed(0)}%`;
    const latency = m.avgLatencyMs > 0 ? `${m.avgLatencyMs.toFixed(0)} ms avg` : 'no data';
    lines.push(`  ${status} ${m.methodId}  ${rate} success  ${latency}`);
  }

  lines.push('');
  lines.push(`Smart selection: ${selection.selectedMethodId}`);
  lines.push(`Reasoning: ${selection.reasoning}`);

  return lines.join('\n');
}
