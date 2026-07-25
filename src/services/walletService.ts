import { ethers } from 'ethers';

import { GasEstimate, ChainType } from '../types/wallet';

import { NetworkError, NetworkErrorCode, ContractError, ContractErrorCode } from '../errors';
import { getEvmRpcUrl, getDefaultStellarNetwork, getChainType } from '../config/evm';
import { TokenService } from './tokenService';
import { GasService } from './gasService';
import { StreamService } from './streamService';
import { PaymentMethodService } from './paymentMethodService';
import {
  WalletConnection,
  WalletError,
  WalletErrorCode,
  errorTracker,
  TokenBalance,
  SuperfluidStreamResult,
  SuperfluidCreateFlowContext,
  WalletServiceContext,
  isUserRejectedError,
} from './walletServiceShared';

export { GasEstimate };
export { NetworkError, NetworkErrorCode, ContractError, ContractErrorCode };
export {
  PaymentMethodService,
  PaymentMethodError,
  PaymentMethodErrorCode,
} from './paymentMethodService';
export {
  WalletConnection,
  WalletError,
  WalletErrorCode,
  errorTracker,
  TokenBalance,
  SuperfluidStreamResult,
} from './walletServiceShared';

export type { StreamSetup } from './walletServiceShared';

export interface SupportedChainInfo {
  chainType: ChainType;
  chainId: number;
  name: string;
  rpcUrl?: string;
}

export class WalletServiceManager implements WalletServiceContext {
  private static instance: WalletServiceManager;
  private connection: WalletConnection | null = null;
  private listeners: ((connection: WalletConnection | null) => void)[] = [];
  private readonly tokenService: TokenService;
  private readonly gasService: GasService;
  private readonly streamService: StreamService;

  private readonly supportedChains: SupportedChainInfo[] = [
    { chainType: ChainType.EVM, chainId: 1, name: 'Ethereum', rpcUrl: 'https://cloudflare-eth.com' },
    { chainType: ChainType.EVM, chainId: 137, name: 'Polygon', rpcUrl: 'https://polygon-rpc.com' },
    { chainType: ChainType.EVM, chainId: 42161, name: 'Arbitrum', rpcUrl: 'https://arb1.arbitrum.io/rpc' },
    { chainType: ChainType.EVM, chainId: 10, name: 'Optimism', rpcUrl: 'https://mainnet.optimism.io' },
    { chainType: ChainType.EVM, chainId: 8453, name: 'Base', rpcUrl: 'https://mainnet.base.org' },
    { chainType: ChainType.STELLAR, chainId: 0x8000, name: 'Stellar (Soroban)' },
  ];

  constructor() {
    this.tokenService = new TokenService(this);
    this.gasService = new GasService(this);
    this.streamService = new StreamService(this);
  }

  static getInstance(): WalletServiceManager {
    if (!WalletServiceManager.instance) {
      WalletServiceManager.instance = new WalletServiceManager();
    }
    return WalletServiceManager.instance;
  }

  async initialize(): Promise<void> {
    // Initialization is intentionally lightweight for now.
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
    this.connection = null;
    this.notifyListeners();
  }

  getSupportedChains(): SupportedChainInfo[] {
    return [...this.supportedChains];
  }

  getStellarProvider(): any {
    if (typeof window !== 'undefined' && (window as any).stellarProvider) {
      return (window as any).stellarProvider;
    }
    if (typeof window !== 'undefined' && (window as any).freighter) {
      return (window as any).freighter;
    }
    return null;
  }

  async connectStellarWallet(): Promise<WalletConnection> {
    try {
      const freighterApi = this.getStellarProvider();
      if (!freighterApi || !freighterApi.isConnected) {
        throw new WalletError(
          WalletErrorCode.NOT_CONNECTED,
          'Freighter wallet is not available.',
          'Please install Freighter wallet extension and try again.'
        );
      }

      const publicKey = await freighterApi.getPublicKey();
      const network = getDefaultStellarNetwork();

      const connection: WalletConnection = {
        address: publicKey,
        chainId: 0x8000,
        chainType: ChainType.STELLAR,
        isConnected: true,
        stellarPublicKey: publicKey,
      };

      this.setConnection(connection);
      return connection;
    } catch (error) {
      if (error instanceof WalletError) throw error;
      throw new WalletError(
        WalletErrorCode.NOT_CONNECTED,
        'Failed to connect to Stellar wallet.',
        'Check Freighter extension and try again.',
        error
      );
    }
  }

  async connectEvmWallet(eip1193Provider: ethers.providers.ExternalProvider): Promise<WalletConnection> {
    try {
      const web3Provider = new ethers.providers.Web3Provider(eip1193Provider);
      const accounts = await web3Provider.send('eth_requestAccounts', []);
      const network = await web3Provider.getNetwork();

      const connection: WalletConnection = {
        address: accounts[0],
        chainId: network.chainId,
        chainType: ChainType.EVM,
        isConnected: true,
        provider: web3Provider,
        eip1193Provider,
      };

      this.setConnection(connection);
      return connection;
    } catch (error) {
      if (isUserRejectedError(error)) {
        throw new WalletError(
          WalletErrorCode.USER_REJECTED,
          'Connection was rejected.',
          'Approve connection in your wallet to continue.'
        );
      }
      throw new WalletError(
        WalletErrorCode.NOT_CONNECTED,
        'Failed to connect EVM wallet.',
        'Check your wallet extension and try again.',
        error
      );
    }
  }

  async switchChain(chainType: ChainType, chainId: number): Promise<void> {
    const conn = this.connection;
    if (!conn) {
      throw new WalletError(
        WalletErrorCode.NOT_CONNECTED,
        'No wallet connected.',
        'Connect a wallet first.'
      );
    }

    if (chainType === ChainType.EVM) {
      if (!conn.eip1193Provider) {
        throw new WalletError(
          WalletErrorCode.NOT_CONNECTED,
          'No EVM wallet connected.',
          'Connect an EVM wallet first.'
        );
      }

      try {
        await conn.eip1193Provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: `0x${chainId.toString(16)}` }],
        });
      } catch (switchError: any) {
        if (switchError.code === 4902) {
          throw new WalletError(
            WalletErrorCode.NETWORK_MISMATCH,
            `Chain ${chainId} is not available in your wallet.`,
            'Add the chain to your wallet first.'
          );
        }
        throw new WalletError(
          WalletErrorCode.NETWORK_MISMATCH,
          'Failed to switch chain.',
          'Try switching manually in your wallet.',
          switchError
        );
      }

      const web3Provider = new ethers.providers.Web3Provider(conn.eip1193Provider);
      const network = await web3Provider.getNetwork();

      this.setConnection({
        ...conn,
        chainId: network.chainId,
        chainType: ChainType.EVM,
        provider: web3Provider,
      });
    } else if (chainType === ChainType.STELLAR) {
      if (!conn.stellarPublicKey) {
        await this.connectStellarWallet();
      }
      this.setConnection({
        ...conn,
        chainId: 0x8000,
        chainType: ChainType.STELLAR,
      });
    }
  }

  async getTokenBalances(address: string, chainId: number): Promise<TokenBalance[]> {
    const chainType = getChainType(chainId);
    if (chainType === ChainType.STELLAR) {
      return this.getStellarTokenBalances(address);
    }
    return this.tokenService.getTokenBalances(address, chainId);
  }

  private async getStellarTokenBalances(address: string): Promise<TokenBalance[]> {
    try {
      const network = getDefaultStellarNetwork();
      const response = await fetch(`${network.horizonUrl}/accounts/${address}`);
      if (!response.ok) {
        throw new Error('Failed to fetch Stellar account');
      }
      const accountData = await response.json();

      const balances: TokenBalance[] = accountData.balances.map((bal: any) => ({
        symbol: bal.asset_type === 'native' ? 'XLM' : bal.asset_code,
        name: bal.asset_type === 'native' ? 'Stellar Lumens' : bal.asset_code,
        address: bal.asset_type === 'native' ? 'native' : `${bal.asset_code}:${bal.asset_issuer}`,
        balance: bal.balance,
        decimals: bal.asset_type === 'native' ? 7 : 7,
      }));

      return balances;
    } catch (error) {
      errorTracker.record(WalletErrorCode.BALANCE_FETCH_FAILED);
      throw new WalletError(
        WalletErrorCode.BALANCE_FETCH_FAILED,
        'Failed to fetch Stellar token balances.',
        'Check the address and try again.',
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
    const chainType = getChainType(chainId);
    if (chainType === ChainType.STELLAR) {
      return this.estimateStellarGas();
    }
    return this.gasService.estimateGas(from, to, value, chainId, userGasLimitOverride);
  }

  private async estimateStellarGas(): Promise<GasEstimate> {
    return {
      gasLimit: '1000000',
      gasPrice: '0.00001',
      estimatedCost: '0.01',
    };
  }

  getWalletSigner(): ethers.Signer {
    const conn = this.connection;
    if (!conn?.eip1193Provider) {
      const err = new WalletError(
        WalletErrorCode.NOT_CONNECTED,
        'EVM wallet is not connected.',
        'Connect an EVM wallet and try again.'
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
  ): Promise<SuperfluidCreateFlowContext> {
    const streamService = this.streamService as unknown as {
      buildSuperfluidCreateFlowContext: (
        tokenSymbol: string,
        amountPerMonth: string,
        recipient: string,
        chainId: number,
        signer: ethers.Signer
      ) => Promise<SuperfluidCreateFlowContext>;
    };

    return streamService.buildSuperfluidCreateFlowContext(
      tokenSymbol,
      amountPerMonth,
      recipient,
      chainId,
      signer
    );
  }

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
      if (error instanceof WalletError) {
        throw error;
      }
      throw new WalletError(
        WalletErrorCode.STREAM_CREATION_FAILED,
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
    return this.streamService.createSablierStream(
      token,
      amount,
      startTime,
      stopTime,
      recipient,
      chainId
    );
  }

  async getErc20Allowance(
    token: string,
    owner: string,
    spender: string,
    chainId: number
  ): Promise<ethers.BigNumber> {
    return this.tokenService.getErc20Allowance(token, owner, spender, chainId);
  }

  async estimateApproveGas(
    token: string,
    spender: string,
    amount: ethers.BigNumberish,
    chainId: number
  ): Promise<GasEstimate> {
    return this.gasService.estimateApproveGas(token, spender, amount, chainId);
  }

  async approveErc20(token: string, spender: string, amount: ethers.BigNumberish): Promise<string> {
    return this.gasService.approveErc20(token, spender, amount);
  }

  getProvider(chainId: number): ethers.providers.JsonRpcProvider {
    const chainType = getChainType(chainId);
    if (chainType === ChainType.STELLAR) {
      throw new Error('Stellar provider is not an ethers provider. Use getStellarProvider() instead.');
    }
    return new ethers.providers.JsonRpcProvider(getEvmRpcUrl(chainId));
  }

  isConnected(): boolean {
    return this.connection?.isConnected || false;
  }

  isStellarConnected(): boolean {
    return this.connection?.chainType === ChainType.STELLAR && this.connection.isConnected;
  }

  isEvmConnected(): boolean {
    return this.connection?.chainType === ChainType.EVM && this.connection.isConnected;
  }
}

// Export singleton instance
export const walletServiceManager = WalletServiceManager.getInstance();
export const paymentMethodService = PaymentMethodService.getInstance(walletServiceManager);
export default walletServiceManager;
