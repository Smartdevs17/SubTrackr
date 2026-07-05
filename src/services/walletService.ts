import { ethers } from 'ethers';

import { GasEstimate } from '../types/wallet';

import { NetworkError, NetworkErrorCode, ContractError, ContractErrorCode } from '../errors';
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

export class WalletServiceManager implements WalletServiceContext {
  private static instance: WalletServiceManager;
  private connection: WalletConnection | null = null;
  private listeners: ((connection: WalletConnection | null) => void)[] = [];
  private readonly tokenService: TokenService;
  private readonly gasService: GasService;
  private readonly streamService: StreamService;

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

  async getTokenBalances(address: string, chainId: number): Promise<TokenBalance[]> {
    return this.tokenService.getTokenBalances(address, chainId);
  }

  async estimateGas(
    from: string,
    to: string,
    value: string,
    chainId: number,
    userGasLimitOverride?: string
  ): Promise<GasEstimate> {
    return this.gasService.estimateGas(from, to, value, chainId, userGasLimitOverride);
  }

  getWalletSigner(): ethers.Signer {
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
    const streamService = this.streamService as unknown as {
      buildSuperfluidCreateFlowContext: (
        tokenSymbol: string,
        amountPerMonth: string,
        recipient: string,
        chainId: number,
        signer: ethers.Signer
      ) => Promise<unknown>;
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
    return new ethers.providers.JsonRpcProvider(getEvmRpcUrl(chainId));
  }

  isConnected(): boolean {
    return this.connection?.isConnected || false;
  }
}

// Export singleton instance
export const walletServiceManager = WalletServiceManager.getInstance();
export const paymentMethodService = PaymentMethodService.getInstance(walletServiceManager);
export default walletServiceManager;
