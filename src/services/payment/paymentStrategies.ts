import { ChainType } from '../../types/wallet';

export interface PaymentParams {
  recipient: string;
  amount: string;
  tokenSymbol: string;
  tokenAddress?: string;
  memo?: string;
}

export interface PaymentResult {
  success: boolean;
  transactionHash?: string;
  chainType: ChainType;
  error?: string;
  timestamp: number;
}

export interface PaymentStrategy {
  readonly chainType: ChainType;
  executePayment(params: PaymentParams): Promise<PaymentResult>;
  estimateGasFee(params: PaymentParams): Promise<string>;
  validateRecipient(address: string): boolean;
}

export class EVMPaymentStrategy implements PaymentStrategy {
  readonly chainType = ChainType.EVM;

  async executePayment(params: PaymentParams): Promise<PaymentResult> {
    if (!this.validateRecipient(params.recipient)) {
      return {
        success: false,
        chainType: ChainType.EVM,
        error: 'Invalid EVM recipient address',
        timestamp: Date.now(),
      };
    }
    // Mock EVM payment execution
    const mockHash = `0x${Math.random().toString(16).substring(2)}${Math.random().toString(16).substring(2)}`;
    return {
      success: true,
      transactionHash: mockHash,
      chainType: ChainType.EVM,
      timestamp: Date.now(),
    };
  }

  async estimateGasFee(params: PaymentParams): Promise<string> {
    return '0.0025 ETH';
  }

  validateRecipient(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }
}

export class StellarPaymentStrategy implements PaymentStrategy {
  readonly chainType = ChainType.STELLAR;

  async executePayment(params: PaymentParams): Promise<PaymentResult> {
    if (!this.validateRecipient(params.recipient)) {
      return {
        success: false,
        chainType: ChainType.STELLAR,
        error: 'Invalid Stellar account address',
        timestamp: Date.now(),
      };
    }
    // Mock Stellar Soroban payment execution
    const mockHash = `stellar-tx-${Math.random().toString(36).substring(2)}`;
    return {
      success: true,
      transactionHash: mockHash,
      chainType: ChainType.STELLAR,
      timestamp: Date.now(),
    };
  }

  async estimateGasFee(params: PaymentParams): Promise<string> {
    return '0.00001 XLM';
  }

  validateRecipient(address: string): boolean {
    return address.startsWith('G') && address.length === 56;
  }
}

export class PaymentStrategyFactory {
  private static strategies: Map<ChainType, PaymentStrategy> = new Map<ChainType, PaymentStrategy>([
    [ChainType.EVM, new EVMPaymentStrategy()],
    [ChainType.STELLAR, new StellarPaymentStrategy()],
  ]);

  public static getStrategy(chainType: ChainType): PaymentStrategy {
    const strategy = this.strategies.get(chainType);
    if (!strategy) {
      throw new Error(`No payment strategy registered for chain type: ${chainType}`);
    }
    return strategy;
  }

  public static getStrategyForToken(tokenSymbol: string): PaymentStrategy {
    if (tokenSymbol.toUpperCase() === 'XLM' || tokenSymbol.toUpperCase() === 'XLM-SOROBAN') {
      return this.getStrategy(ChainType.STELLAR);
    }
    return this.getStrategy(ChainType.EVM);
  }

  public static registerStrategy(chainType: ChainType, strategy: PaymentStrategy): void {
    this.strategies.set(chainType, strategy);
  }
}

export class UnifiedPaymentTracker {
  private static history: PaymentResult[] = [];

  public static trackPayment(result: PaymentResult): void {
    this.history.push(result);
  }

  public static getHistory(): PaymentResult[] {
    return [...this.history];
  }

  public static clearHistory(): void {
    this.history = [];
  }
}
