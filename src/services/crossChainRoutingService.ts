import { ethers } from 'ethers';
import { ChainType } from '../types/wallet';
import { walletServiceManager, WalletError, WalletErrorCode } from './walletService';

export interface CrossChainPaymentRoute {
  sourceChainType: ChainType;
  sourceChainId: number;
  targetChainType: ChainType;
  targetChainId: number;
  tokenAddress: string;
  amount: string;
  estimatedFee: string;
  estimatedTime: string;
}

export interface PaymentRouteRequest {
  sourceChainType: ChainType;
  sourceChainId: number;
  targetChainType: ChainType;
  targetChainId: number;
  tokenSymbol: string;
  amount: string;
}

const BRIDGE_CONTRACTS: Record<string, string> = {
  'stellar:evm:USDC': 'CGBJ37ATV7C3Q4Y7JQ3QFZ3Y7Y7Y7Y7Y7Y7Y7Y7Y7Y7Y7Y7Y7Y7Y7Y7',
};

const CHAINLINK_PRICING: Record<string, string> = {
  'XLM-USD': '0x47Fb2585D2C56Fe1D3C1F9B9bC5bF1B0C9E5E2B1',
  'ETH-USD': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
  'USDC-USD': '0x8fFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFf',
};

export class CrossChainRoutingService {
  private static instance: CrossChainRoutingService;

  static getInstance(): CrossChainRoutingService {
    if (!CrossChainRoutingService.instance) {
      CrossChainRoutingService.instance = new CrossChainRoutingService();
    }
    return CrossChainRoutingService.instance;
  }

  async findPaymentRoute(request: PaymentRouteRequest): Promise<CrossChainPaymentRoute> {
    if (request.sourceChainType === request.targetChainType) {
      return {
        sourceChainType: request.sourceChainType,
        sourceChainId: request.sourceChainId,
        targetChainType: request.targetChainType,
        targetChainId: request.targetChainId,
        tokenAddress: request.tokenSymbol,
        amount: request.amount,
        estimatedFee: '0',
        estimatedTime: 'instant',
      };
    }

    const bridgeKey = `${request.sourceChainType}:${request.targetChainType}:${request.tokenSymbol}`;
    const bridgeContract = BRIDGE_CONTRACTS[bridgeKey];

    if (!bridgeContract) {
      throw new WalletError(
        WalletErrorCode.STREAM_CREATION_FAILED,
        `No bridge available for ${request.sourceChainType} -> ${request.targetChainType} ${request.tokenSymbol}`,
        'Try a different token or chain combination.'
      );
    }

    const estimatedFee = this.calculateBridgeFee(request.amount, request.tokenSymbol);

    return {
      sourceChainType: request.sourceChainType,
      sourceChainId: request.sourceChainId,
      targetChainType: request.targetChainType,
      targetChainId: request.targetChainId,
      tokenAddress: bridgeContract,
      amount: request.amount,
      estimatedFee,
      estimatedTime: '~5 minutes',
    };
  }

  async executePayment(route: CrossChainPaymentRoute): Promise<string> {
    const conn = walletServiceManager.getConnection();
    if (!conn) {
      throw new WalletError(
        WalletErrorCode.NOT_CONNECTED,
        'No wallet connected.',
        'Connect a wallet to proceed.'
      );
    }

    if (route.sourceChainType === ChainType.STELLAR) {
      return this.executeStellarPayment(route);
    }
    return this.executeEvmPayment(route);
  }

  private async executeStellarPayment(route: CrossChainPaymentRoute): Promise<string> {
    try {
      const freighterApi = walletServiceManager.getStellarProvider();
      if (!freighterApi) {
        throw new WalletError(
          WalletErrorCode.NOT_CONNECTED,
          'Freighter wallet is required.',
          'Please install Freighter extension.'
        );
      }

      const publicKey = await freighterApi.getPublicKey();
      const txXdr = await this.buildStellarTransferTx(publicKey, route);
      const signedTx = await freighterApi.signTransaction(txXdr);
      const result = await freighterApi.submitTransaction(signedTx);

      return result.hash;
    } catch (error) {
      throw new WalletError(
        WalletErrorCode.STREAM_CREATION_FAILED,
        'Stellar payment failed.',
        'Check balance and try again.',
        error
      );
    }
  }

  private async executeEvmPayment(route: CrossChainPaymentRoute): Promise<string> {
    const signer = walletServiceManager.getWalletSigner();
    const conn = walletServiceManager.getConnection();

    if (conn?.chainId !== route.sourceChainId) {
      throw new WalletError(
        WalletErrorCode.NETWORK_MISMATCH,
        `Wrong network. Expected chain ${route.sourceChainId}.`,
        'Switch network in your wallet.'
      );
    }

    const tx = await signer.sendTransaction({
      to: route.tokenAddress,
      value: ethers.utils.parseEther(route.amount),
    });

    const receipt = await tx.wait();
    return receipt.transactionHash;
  }

  async getCrossChainConversionRate(
    fromChain: ChainType,
    fromToken: string,
    toChain: ChainType,
    toToken: string
  ): Promise<number> {
    try {
      const fromSymbol = fromToken.toUpperCase();
      const toSymbol = toToken.toUpperCase();

      if (fromSymbol === toSymbol) {
        return 1;
      }

      const fromPriceFeed = this.getPriceFeed(fromSymbol);
      const toPriceFeed = this.getPriceFeed(toSymbol);

      const fromPrice = await this.fetchTokenPrice(fromPriceFeed);
      const toPrice = await this.fetchTokenPrice(toPriceFeed);

      if (toPrice === 0) return 1;
      return fromPrice / toPrice;
    } catch {
      return 1;
    }
  }

  private getPriceFeed(symbol: string): string {
    const feedKey = `${symbol}-USD`;
    return CHAINLINK_PRICING[feedKey] || '';
  }

  private async fetchTokenPrice(feedAddress: string): Promise<number> {
    if (!feedAddress) return 1;
    try {
      const provider = walletServiceManager.getProvider(1);
      const abi = [
        'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
      ];
      const feed = new ethers.Contract(feedAddress, abi, provider);
      const [, answer] = await feed.latestRoundData();
      return Number(ethers.utils.formatUnits(answer, 8));
    } catch {
      return 1;
    }
  }

  private calculateBridgeFee(amount: string, _tokenSymbol: string): string {
    const parsedAmount = parseFloat(amount);
    const feePercent = 0.001;
    return (parsedAmount * feePercent).toFixed(6);
  }

  private async buildStellarTransferTx(
    publicKey: string,
    route: CrossChainPaymentRoute
  ): Promise<string> {
    return `AAAAAgAAAAD${publicKey}...mock_xdr_for_demo`;
  }

  async aggregateBilling(
    subscriptions: { chainType: ChainType; amount: number; currency: string }[]
  ): Promise<{
    totalInPreferredCurrency: number;
    chainBreakdown: Record<string, number>;
    conversionRates: Record<string, number>;
  }> {
    const preferredCurrency = 'USD';
    const chainBreakdown: Record<string, number> = {};
    const conversionRates: Record<string, number> = {};
    let totalInPreferredCurrency = 0;

    for (const sub of subscriptions) {
      const chainKey = `${sub.chainType}:${sub.currency}`;
      if (!conversionRates[chainKey]) {
        conversionRates[chainKey] = await this.getCrossChainConversionRate(
          sub.chainType,
          sub.currency,
          ChainType.EVM,
          preferredCurrency
        );
      }

      const convertedAmount = sub.amount * conversionRates[chainKey];
      totalInPreferredCurrency += convertedAmount;

      const chainGroup = sub.chainType === ChainType.STELLAR ? 'stellar' : `evm`;
      chainBreakdown[chainGroup] = (chainBreakdown[chainGroup] || 0) + convertedAmount;
    }

    return { totalInPreferredCurrency, chainBreakdown, conversionRates };
  }
}

export const crossChainRoutingService = CrossChainRoutingService.getInstance();
