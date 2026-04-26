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

function formatSuperfluidError(error: unknown): string {
  if (error instanceof SFError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Superfluid stream creation failed';
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
      console.error('Failed to get token balances:', error);
      throw error;
    }
  }

  async estimateGas(
    from: string,
    to: string,
    value: string,
    chainId: number,
    userGasLimitOverride?: string
  ): Promise<GasEstimate> {
    const provider = this.getProvider(chainId);

    const gasPrice = await this.resolveGasPrice(provider);

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
      throw new Error('Wallet is not connected or does not expose a signing provider.');
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
        throw new Error('Transaction was rejected in your wallet.');
      }
      console.error('Failed to create Superfluid stream:', error);
      throw new Error(formatSuperfluidError(error));
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
        throw new Error('Transaction was rejected in your wallet.');
      }
      console.error('Failed to create Sablier stream:', error);
      throw error;
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
      throw new Error('Wallet is not connected for gas estimation.');
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
    const tx = await erc20.approve(spender, amount);
    const receipt = await tx.wait();
    if (!receipt?.transactionHash) {
      throw new Error('Approval transaction mined without a hash');
    }
    return receipt.transactionHash;
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

// Export singleton instance
export const walletServiceManager = WalletServiceManager.getInstance();
export default walletServiceManager;
