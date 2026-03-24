import { ethers } from 'ethers';
import { Framework, SFError } from '@superfluid-finance/sdk-core';

import { ERC20__factory, getContractAddress } from '../contracts';
import { getEvmRpcUrl } from '../config/evm';

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

const SECONDS_PER_MONTH = 30 * 24 * 60 * 60;

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
    if (chainId === 137) return 'MATICx';
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
  private listeners: Array<(connection: WalletConnection | null) => void> = [];

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
        decimals: 18,
      });

      // Get USDC balance if on supported chains
      if (chainId === 1 || chainId === 137 || chainId === 42161) {
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
            balance: ethers.utils.formatUnits(usdcBalance, 6),
            decimals: 6,
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
    chainId: number
  ): Promise<GasEstimate> {
    try {
      const provider = this.getProvider(chainId);
      const gasPrice = await provider.getGasPrice();
      const gasLimit = ethers.BigNumber.from('21000'); // Standard ETH transfer

      const estimatedCost = gasPrice.mul(gasLimit);

      return {
        gasLimit: gasLimit.toString(),
        gasPrice: ethers.utils.formatUnits(gasPrice, 'gwei'),
        estimatedCost: ethers.utils.formatEther(estimatedCost),
      };
    } catch (error) {
      console.error('Failed to estimate gas:', error);
      throw error;
    }
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
      // This is a simplified implementation
      // In production, you'd use the full Sablier SDK
      console.log('Creating Sablier stream:', {
        token,
        amount,
        startTime,
        stopTime,
        recipient,
        chainId,
      });

      // Simulate stream creation
      await new Promise((resolve) => setTimeout(resolve, 2000));

      return `sablier_${Date.now()}`;
    } catch (error) {
      console.error('Failed to create Sablier stream:', error);
      throw error;
    }
  }

  private getProvider(chainId: number): ethers.providers.JsonRpcProvider {
    return new ethers.providers.JsonRpcProvider(getEvmRpcUrl(chainId));
  }

  private getNativeSymbol(chainId: number): string {
    const symbols: Record<number, string> = {
      1: 'ETH',
      137: 'MATIC',
      42161: 'ETH',
    };
    return symbols[chainId] || 'ETH';
  }

  private getNativeName(chainId: number): string {
    const names: Record<number, string> = {
      1: 'Ethereum',
      137: 'Polygon',
      42161: 'Arbitrum',
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
