import { ethers } from 'ethers';
import { Framework } from '@superfluid-finance/sdk-core';

import { logger } from './logging';
import { PaymentMethodService } from './paymentMethodService';
import { ERC20__factory, getContractAddress } from '../contracts';
import { getEvmRpcUrl, getEvmRpcUrls } from '../config/evm';
import { getOrCreateResilientProvider } from './rpcProvider';
import { ContractError, ContractErrorCode, NetworkError, NetworkErrorCode } from '../errors';
import {
  TIME_CONSTANTS,
  CRYPTO_CONSTANTS,
  CHAIN_IDS,
  ADDRESS_CONSTANTS,
  STELLAR_CHAINS,
} from '../utils/constants/values';
import { ChainType } from '../types/wallet';

export { ContractError, ContractErrorCode, NetworkError, NetworkErrorCode };

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

  constructor(code: WalletErrorCode, userMessage: string, recovery?: string, cause?: unknown) {
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
  chainType?: ChainType;
  isConnected: boolean;
  provider?: ethers.providers.Web3Provider;
  /** EIP-1193 provider from WalletConnect / AppKit — required for signing Superfluid txs */
  eip1193Provider?: ethers.providers.ExternalProvider;
  /** Stellar-specific public key for Freighter/Soroban payments. */
  stellarPublicKey?: string;
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

export interface SupportedWalletChain {
  chainType: ChainType;
  chainId: number;
  name: string;
  nativeSymbol: string;
}

interface GasEstimateRequest {
  from: string;
  to: string;
  value: string;
  chainId: number;
  userGasLimitOverride?: string;
}

interface WalletChainStrategyContext {
  getConnection(): WalletConnection | null;
  setConnection(connection: WalletConnection | null): void;
  getWalletSigner(): ethers.Signer;
}

export interface WalletChainStrategy {
  readonly chainType: ChainType;
  supportsChain(chainId: number): boolean;
  getSupportedChains(): SupportedWalletChain[];
  getTokenBalances(
    address: string,
    chainId: number,
    context: WalletChainStrategyContext
  ): Promise<TokenBalance[]>;
  estimateGas?(
    request: GasEstimateRequest,
    context: WalletChainStrategyContext
  ): Promise<GasEstimate>;
  switchChain?(chainId: number, context: WalletChainStrategyContext): Promise<WalletConnection>;
  connect?(context: WalletChainStrategyContext): Promise<WalletConnection>;
  getProvider?(chainId: number): ethers.providers.JsonRpcProvider;
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

export class EvmWalletChainStrategy implements WalletChainStrategy {
  readonly chainType = ChainType.EVM;

  supportsChain(chainId: number): boolean {
    return chainId !== CHAIN_IDS.STELLAR && chainId !== STELLAR_CHAINS.TESTNET;
  }

  getSupportedChains(): SupportedWalletChain[] {
    return [
      {
        chainType: ChainType.EVM,
        chainId: CHAIN_IDS.ETHEREUM,
        name: 'Ethereum',
        nativeSymbol: 'ETH',
      },
      {
        chainType: ChainType.EVM,
        chainId: CHAIN_IDS.POLYGON,
        name: 'Polygon',
        nativeSymbol: 'MATIC',
      },
      {
        chainType: ChainType.EVM,
        chainId: CHAIN_IDS.ARBITRUM,
        name: 'Arbitrum',
        nativeSymbol: 'ETH',
      },
      {
        chainType: ChainType.EVM,
        chainId: CHAIN_IDS.OPTIMISM,
        name: 'Optimism',
        nativeSymbol: 'ETH',
      },
      { chainType: ChainType.EVM, chainId: CHAIN_IDS.BASE, name: 'Base', nativeSymbol: 'ETH' },
    ];
  }

  async getTokenBalances(address: string, chainId: number): Promise<TokenBalance[]> {
    try {
      const provider = this.getProvider(chainId);
      const balances: TokenBalance[] = [];
      const nativeBalance = await provider.getBalance(address);

      balances.push({
        symbol: getNativeSymbolForChain(chainId),
        name: getNativeNameForChain(chainId),
        address: ADDRESS_CONSTANTS.ZERO_ADDRESS,
        balance: ethers.utils.formatEther(nativeBalance),
        decimals: CRYPTO_CONSTANTS.ETH_DECIMALS,
      });

      if (isUsdcBalanceSupported(chainId)) {
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
        } catch (error) {
          logger.warn('USDC not available on this chain', { chainId, error });
        }
      }

      return balances;
    } catch (error) {
      throw new NetworkError(
        NetworkErrorCode.RPC_ERROR,
        'Unable to fetch token balances.',
        'Check your network connection and try again.',
        error,
        { chainId, address }
      );
    }
  }

  async estimateGas(request: GasEstimateRequest): Promise<GasEstimate> {
    let provider: ethers.providers.JsonRpcProvider;
    let gasPrice: ethers.BigNumber;

    try {
      provider = this.getProvider(request.chainId);
      gasPrice = await resolveGasPrice(provider);
    } catch (error) {
      throw new NetworkError(
        NetworkErrorCode.RPC_ERROR,
        'Could not retrieve gas price.',
        'Check your network connection and try again.',
        error,
        { chainId: request.chainId }
      );
    }

    let gasLimit: ethers.BigNumber;

    if (request.userGasLimitOverride) {
      gasLimit = ethers.BigNumber.from(request.userGasLimitOverride);
    } else {
      try {
        const estimated = await provider.estimateGas({
          from: request.from,
          to: request.to,
          value: ethers.utils.parseEther(request.value || '0'),
        });
        gasLimit = estimated.mul(getGasBufferMultiplier(request.chainId)).div(100);
      } catch (error) {
        logger.warn('Gas estimation failed, using safe fallback', { error });
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

  async switchChain(
    chainId: number,
    context: WalletChainStrategyContext
  ): Promise<WalletConnection> {
    const connection = context.getConnection();
    if (!connection?.eip1193Provider) {
      const err = new WalletError(
        WalletErrorCode.NOT_CONNECTED,
        'EVM wallet is not connected.',
        'Connect your EVM wallet and try again.'
      );
      errorTracker.record(WalletErrorCode.NOT_CONNECTED);
      throw err;
    }

    const request = (
      connection.eip1193Provider as { request?: (args: unknown) => Promise<unknown> }
    ).request;
    if (request) {
      await request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: ethers.utils.hexValue(chainId) }],
      });
    }

    const nextConnection = { ...connection, chainType: ChainType.EVM, chainId };
    context.setConnection(nextConnection);
    return nextConnection;
  }

  getProvider(chainId: number): ethers.providers.JsonRpcProvider {
    const urls = resolveEvmRpcUrls(chainId);
    if (process.env.NODE_ENV === 'test') {
      return new ethers.providers.JsonRpcProvider(
        urls[0],
        chainId
      ) as ethers.providers.JsonRpcProvider;
    }
    return getOrCreateResilientProvider(
      chainId,
      urls
    ) as unknown as ethers.providers.JsonRpcProvider;
  }
}

export class StellarWalletChainStrategy implements WalletChainStrategy {
  readonly chainType = ChainType.STELLAR;

  supportsChain(chainId: number): boolean {
    return chainId === CHAIN_IDS.STELLAR || chainId === STELLAR_CHAINS.TESTNET;
  }

  getSupportedChains(): SupportedWalletChain[] {
    return [
      {
        chainType: ChainType.STELLAR,
        chainId: CHAIN_IDS.STELLAR,
        name: 'Stellar Mainnet',
        nativeSymbol: 'XLM',
      },
      {
        chainType: ChainType.STELLAR,
        chainId: STELLAR_CHAINS.TESTNET,
        name: 'Stellar Testnet',
        nativeSymbol: 'XLM',
      },
    ];
  }

  async getTokenBalances(address: string, chainId: number): Promise<TokenBalance[]> {
    if (!this.supportsChain(chainId)) {
      throw new NetworkError(
        NetworkErrorCode.UNSUPPORTED_CHAIN,
        `Unsupported Stellar chain ${chainId}.`,
        'Select a supported Stellar network.'
      );
    }

    return [
      {
        symbol: 'XLM',
        name: 'Stellar Lumens',
        address,
        balance: '0',
        decimals: 7,
      },
    ];
  }

  async estimateGas(): Promise<GasEstimate> {
    return {
      gasLimit: '100',
      gasPrice: '0.00001',
      estimatedCost: '0.001',
    };
  }

  async connect(context: WalletChainStrategyContext): Promise<WalletConnection> {
    const provider = resolveStellarWalletProvider();
    if (!provider?.getPublicKey) {
      const err = new WalletError(
        WalletErrorCode.NOT_CONNECTED,
        'Stellar wallet is not connected.',
        'Install Freighter or connect a compatible Stellar wallet.'
      );
      errorTracker.record(WalletErrorCode.NOT_CONNECTED);
      throw err;
    }

    const publicKey = await provider.getPublicKey();
    const connection: WalletConnection = {
      address: publicKey,
      stellarPublicKey: publicKey,
      chainId: CHAIN_IDS.STELLAR,
      chainType: ChainType.STELLAR,
      isConnected: true,
    };
    context.setConnection(connection);
    return connection;
  }

  async switchChain(
    chainId: number,
    context: WalletChainStrategyContext
  ): Promise<WalletConnection> {
    if (!this.supportsChain(chainId)) {
      throw new NetworkError(
        NetworkErrorCode.UNSUPPORTED_CHAIN,
        `Unsupported Stellar chain ${chainId}.`,
        'Select a supported Stellar network.'
      );
    }

    const connection = context.getConnection();
    if (!connection?.stellarPublicKey && !isStellarPublicKey(connection?.address)) {
      return this.connect(context);
    }

    const nextConnection: WalletConnection = {
      address: connection?.stellarPublicKey ?? connection?.address ?? '',
      stellarPublicKey: connection?.stellarPublicKey ?? connection?.address,
      chainId,
      chainType: ChainType.STELLAR,
      isConnected: true,
    };
    context.setConnection(nextConnection);
    return nextConnection;
  }
}

export class WalletChainStrategyRegistry {
  private readonly strategies = new Map<ChainType, WalletChainStrategy>();

  constructor(strategies: WalletChainStrategy[] = []) {
    strategies.forEach((strategy) => this.registerStrategy(strategy));
  }

  registerStrategy(strategy: WalletChainStrategy): void {
    this.strategies.set(strategy.chainType, strategy);
  }

  getStrategy(chainType: ChainType): WalletChainStrategy {
    const strategy = this.strategies.get(chainType);
    if (!strategy) {
      throw new Error(`No wallet chain strategy registered for ${chainType}`);
    }
    return strategy;
  }

  getStrategyForChain(chainId: number): WalletChainStrategy {
    for (const strategy of this.strategies.values()) {
      if (strategy.supportsChain(chainId)) {
        return strategy;
      }
    }
    throw new NetworkError(
      NetworkErrorCode.UNSUPPORTED_CHAIN,
      `Unsupported chain ${chainId}.`,
      'Select a supported payment network.'
    );
  }

  getSupportedChains(): SupportedWalletChain[] {
    return [...this.strategies.values()].flatMap((strategy) => strategy.getSupportedChains());
  }
}

export function createDefaultWalletChainStrategyRegistry(): WalletChainStrategyRegistry {
  return new WalletChainStrategyRegistry([
    new EvmWalletChainStrategy(),
    new StellarWalletChainStrategy(),
  ]);
}

function resolveEvmRpcUrls(chainId: number): string[] {
  try {
    if (typeof getEvmRpcUrls === 'function') {
      const configured = getEvmRpcUrls(chainId);
      if (Array.isArray(configured) && configured.length > 0) {
        return configured;
      }
      if (typeof configured === 'string') {
        return [configured];
      }
    }
  } catch {
    // Fall through to the legacy single-url resolver.
  }

  return [getEvmRpcUrl(chainId)];
}

function isUsdcBalanceSupported(chainId: number): boolean {
  return (
    chainId === CHAIN_IDS.ETHEREUM ||
    chainId === CHAIN_IDS.POLYGON ||
    chainId === CHAIN_IDS.ARBITRUM
  );
}

function getGasBufferMultiplier(chainId: number): number {
  return chainId === CHAIN_IDS.POLYGON
    ? CRYPTO_CONSTANTS.POLYGON_GAS_BUFFER_MULTIPLIER
    : CRYPTO_CONSTANTS.DEFAULT_GAS_BUFFER_MULTIPLIER;
}

async function resolveGasPrice(
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

function getNativeSymbolForChain(chainId: number): string {
  const symbols: Record<number, string> = {
    [CHAIN_IDS.ETHEREUM]: 'ETH',
    [CHAIN_IDS.POLYGON]: 'MATIC',
    [CHAIN_IDS.ARBITRUM]: 'ETH',
    [CHAIN_IDS.OPTIMISM]: 'ETH',
    [CHAIN_IDS.BASE]: 'ETH',
  };
  return symbols[chainId] || 'ETH';
}

function getNativeNameForChain(chainId: number): string {
  const names: Record<number, string> = {
    [CHAIN_IDS.ETHEREUM]: 'Ethereum',
    [CHAIN_IDS.POLYGON]: 'Polygon',
    [CHAIN_IDS.ARBITRUM]: 'Arbitrum',
    [CHAIN_IDS.OPTIMISM]: 'Optimism',
    [CHAIN_IDS.BASE]: 'Base',
  };
  return names[chainId] || 'Ethereum';
}

function resolveStellarWalletProvider(): any {
  const globalWallets = globalThis as {
    freighterApi?: any;
    freighter?: any;
    stellar?: any;
  };

  return globalWallets.freighterApi ?? globalWallets.freighter ?? globalWallets.stellar ?? null;
}

function isStellarPublicKey(value: string | undefined): boolean {
  return typeof value === 'string' && value.startsWith('G') && value.length === 56;
}

export class WalletServiceManager {
  private static instance: WalletServiceManager;
  private connection: WalletConnection | null = null;
  private listeners: ((connection: WalletConnection | null) => void)[] = [];
  private readonly strategyRegistry: WalletChainStrategyRegistry;

  constructor(strategyRegistry = createDefaultWalletChainStrategyRegistry()) {
    this.strategyRegistry = strategyRegistry;
  }

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
    return this.strategyRegistry
      .getStrategyForChain(chainId)
      .getTokenBalances(address, chainId, this);
  }

  async estimateGas(
    from: string,
    to: string,
    value: string,
    chainId: number,
    userGasLimitOverride?: string
  ): Promise<GasEstimate> {
    const strategy = this.strategyRegistry.getStrategyForChain(chainId);
    if (!strategy.estimateGas) {
      throw new NetworkError(
        NetworkErrorCode.UNSUPPORTED_CHAIN,
        `Gas estimation is not supported for chain ${chainId}.`,
        'Select an EVM-compatible network.'
      );
    }

    return strategy.estimateGas({ from, to, value, chainId, userGasLimitOverride }, this);
  }

  getWalletSigner(): ethers.Signer {
    const conn = this.connection;
    if (!conn?.eip1193Provider) {
      const err = new WalletError(
        WalletErrorCode.NOT_CONNECTED,
        'EVM wallet is not connected.',
        'Connect your EVM wallet and try again.'
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
    const gasPrice = await resolveGasPrice(provider);

    const erc20Abi = ['function approve(address spender, uint256 amount) returns (bool)'];
    const conn = this.connection;
    if (!conn?.eip1193Provider) {
      const err = new WalletError(
        WalletErrorCode.NOT_CONNECTED,
        'EVM wallet is not connected.',
        'Connect your EVM wallet and try again.'
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
      gasLimit = estimated.mul(getGasBufferMultiplier(chainId)).div(100);
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
      throw new ContractError(
        ContractErrorCode.EXECUTION_FAILED,
        'Token approval failed.',
        'Check your wallet connection and try again.',
        error
      );
    }
  }

  getProvider(chainId: number): ethers.providers.JsonRpcProvider {
    const strategy = this.strategyRegistry.getStrategy(ChainType.EVM);
    if (!strategy.getProvider) {
      throw new NetworkError(
        NetworkErrorCode.UNSUPPORTED_CHAIN,
        'EVM provider strategy is not registered.',
        'Restart the app and try again.'
      );
    }
    return strategy.getProvider(chainId);
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

  getSupportedChains(): SupportedWalletChain[] {
    return this.strategyRegistry.getSupportedChains();
  }

  getStellarProvider(): any {
    return resolveStellarWalletProvider();
  }

  async connectStellarWallet(): Promise<WalletConnection> {
    const strategy = this.strategyRegistry.getStrategy(ChainType.STELLAR);
    if (!strategy.connect) {
      throw new WalletError(
        WalletErrorCode.NOT_CONNECTED,
        'Stellar wallet support is not available.',
        'Restart the app and try again.'
      );
    }
    return strategy.connect(this);
  }

  async switchChain(chainType: ChainType, chainId: number): Promise<WalletConnection> {
    const strategy = this.strategyRegistry.getStrategy(chainType);
    if (!strategy.switchChain) {
      throw new NetworkError(
        NetworkErrorCode.UNSUPPORTED_CHAIN,
        `Chain switching is not supported for ${chainType}.`,
        'Select a supported payment network.'
      );
    }
    return strategy.switchChain(chainId, this);
  }

  isConnected(): boolean {
    return this.connection?.isConnected || false;
  }

  private resolveChainType(chainId: number): ChainType {
    return this.strategyRegistry.getStrategyForChain(chainId).chainType;
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
  async getBalancesAcrossChains(address: string, chainIds: number[]): Promise<MultiChainBalances> {
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
  static totalsBySymbol(balances: MultiChainBalances, symbol: string): Record<number, number> {
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
export type { PaymentMethodExpiryCheck, ChainPaymentResult } from './paymentMethodService';

// Export singleton instances
export const walletServiceManager = WalletServiceManager.getInstance();
export const paymentMethodService = PaymentMethodService.getInstance();
export default walletServiceManager;
