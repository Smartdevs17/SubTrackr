import { ethers } from 'ethers';

import { ERC20__factory, getContractAddress } from '../contracts';

export interface WalletConnection {
  address: string;
  chainId: number;
  isConnected: boolean;
  provider?: ethers.providers.Web3Provider;
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
        } catch (error) {
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

  async createSuperfluidStream(
    token: string,
    flowRate: string,
    recipient: string,
    chainId: number
  ): Promise<string> {
    try {
      // This is a simplified implementation
      // In production, you'd use the full Superfluid SDK
      console.log('Creating Superfluid stream:', { token, flowRate, recipient, chainId });

      // Simulate stream creation
      await new Promise((resolve) => setTimeout(resolve, 2000));

      return `stream_${Date.now()}`;
    } catch (error) {
      console.error('Failed to create Superfluid stream:', error);
      throw error;
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
    const rpcUrls: Record<number, string> = {
      1: 'https://ethereum.publicnode.com',
      137: 'https://polygon-rpc.com',
      42161: 'https://arb1.arbitrum.io/rpc',
    };

    const rpcUrl = rpcUrls[chainId];
    if (!rpcUrl) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    return new ethers.providers.JsonRpcProvider(rpcUrl);
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
