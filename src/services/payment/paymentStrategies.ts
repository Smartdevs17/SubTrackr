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
  /** Present only on failure; carries a machine-readable code. */
  failure?: PaymentFailure;
}

/**
 * Submits a payment and resolves with the real on-chain transaction hash.
 *
 * A strategy never fabricates a hash: if no submitter is wired the payment is
 * rejected as a failure instead of being reported as a success, so a missing
 * signer can never be recorded downstream as a settled payment.
 */
export type PaymentSubmitter = (params: PaymentParams) => Promise<string>;

export interface PaymentStrategy {
  readonly chainType: ChainType;
  executePayment(params: PaymentParams): Promise<PaymentResult>;
  estimateGasFee(params: PaymentParams): Promise<string>;
  validateRecipient(address: string): boolean;
}

/** Error codes shared by every strategy so callers can branch without string matching. */
export enum PaymentStrategyErrorCode {
  INVALID_RECIPIENT = 'INVALID_RECIPIENT',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  NO_SUBMITTER = 'NO_SUBMITTER',
  SUBMISSION_FAILED = 'SUBMISSION_FAILED',
  NO_TX_HASH = 'NO_TX_HASH',
}

export interface PaymentFailure {
  code: PaymentStrategyErrorCode;
  message: string;
  cause?: unknown;
}

const failure = (
  chainType: ChainType,
  code: PaymentStrategyErrorCode,
  message: string,
  cause?: unknown
): PaymentResult => ({
  success: false,
  chainType,
  error: message,
  timestamp: Date.now(),
  failure: { code, message, cause },
});

/**
 * Parse a decimal token amount.
 *
 * Rejects blank input, non-numeric strings, negative values, and zero — an
 * amount that rounds to nothing would otherwise produce a "successful"
 * payment worth nothing.
 */
const parsePositiveAmount = (amount: string): number | null => {
  if (typeof amount !== 'string' || amount.trim().length === 0) return null;
  if (!/^\d*\.?\d+$/.test(amount.trim())) return null;
  const parsed = Number(amount.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

/** Stellar StrKey alphabet (RFC 4648 base32, no padding). */
const STRKEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** Version byte for an ed25519 public key (6 << 3). */
const STRKEY_ED25519_VERSION_BYTE = 6 << 3;

const isStrKeyChar = (char: string): boolean => STRKEY_ALPHABET.indexOf(char) !== -1;

export class EVMPaymentStrategy implements PaymentStrategy {
  readonly chainType = ChainType.EVM;

  constructor(private readonly submitter?: PaymentSubmitter) {}

  async executePayment(params: PaymentParams): Promise<PaymentResult> {
    if (!this.validateRecipient(params.recipient)) {
      return failure(
        this.chainType,
        PaymentStrategyErrorCode.INVALID_RECIPIENT,
        'Invalid EVM recipient address'
      );
    }

    if (parsePositiveAmount(params.amount) === null) {
      return failure(
        this.chainType,
        PaymentStrategyErrorCode.INVALID_AMOUNT,
        `Invalid payment amount: ${params.amount}`
      );
    }

    if (!this.submitter) {
      return failure(
        this.chainType,
        PaymentStrategyErrorCode.NO_SUBMITTER,
        'No EVM payment submitter is configured for this strategy'
      );
    }
    const submitter = this.submitter;

    let transactionHash: string;
    try {
      transactionHash = await submitter(params);
    } catch (error) {
      return failure(
        this.chainType,
        PaymentStrategyErrorCode.SUBMISSION_FAILED,
        error instanceof Error ? error.message : 'EVM payment submission failed',
        error
      );
    }

    if (!transactionHash) {
      return failure(
        this.chainType,
        PaymentStrategyErrorCode.NO_TX_HASH,
        'EVM payment submission returned no transaction hash'
      );
    }

    return {
      success: true,
      transactionHash,
      chainType: this.chainType,
      timestamp: Date.now(),
    };
  }

  async estimateGasFee(params: PaymentParams): Promise<string> {
    return '0.0025 ETH';
  }

  validateRecipient(address: string): boolean {
    return typeof address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(address);
  }
}

export class StellarPaymentStrategy implements PaymentStrategy {
  readonly chainType = ChainType.STELLAR;

  constructor(private readonly submitter?: PaymentSubmitter) {}

  async executePayment(params: PaymentParams): Promise<PaymentResult> {
    if (!this.validateRecipient(params.recipient)) {
      return failure(
        this.chainType,
        PaymentStrategyErrorCode.INVALID_RECIPIENT,
        'Invalid Stellar account address'
      );
    }

    if (parsePositiveAmount(params.amount) === null) {
      return failure(
        this.chainType,
        PaymentStrategyErrorCode.INVALID_AMOUNT,
        `Invalid payment amount: ${params.amount}`
      );
    }

    if (!this.submitter) {
      return failure(
        this.chainType,
        PaymentStrategyErrorCode.NO_SUBMITTER,
        'No Stellar payment submitter is configured for this strategy'
      );
    }
    const submitter = this.submitter;

    let transactionHash: string;
    try {
      transactionHash = await submitter(params);
    } catch (error) {
      return failure(
        this.chainType,
        PaymentStrategyErrorCode.SUBMISSION_FAILED,
        error instanceof Error ? error.message : 'Stellar payment submission failed',
        error
      );
    }

    if (!transactionHash) {
      return failure(
        this.chainType,
        PaymentStrategyErrorCode.NO_TX_HASH,
        'Stellar payment submission returned no transaction hash'
      );
    }

    return {
      success: true,
      transactionHash,
      chainType: this.chainType,
      timestamp: Date.now(),
    };
  }

  async estimateGasFee(params: PaymentParams): Promise<string> {
    return '0.00001 XLM';
  }

  /**
   * Validate a Stellar ed25519 public key.
   *
   * A `G...` prefix with a length of 56 is necessary but not sufficient — the
   * previous check accepted any string of that shape, including one that
   * decodes to the wrong version byte or contains characters outside the
   * StrKey alphabet. Both cases are rejected here so a malformed key cannot
   * reach submission.
   */
  validateRecipient(address: string): boolean {
    if (typeof address !== 'string') return false;
    if (address.length !== 56 || !address.startsWith('G')) return false;
    for (const char of address) {
      if (!isStrKeyChar(char)) return false;
    }

    // Base32 decode the 5-bit groups back into bytes and read the version byte.
    let acc = 0;
    let bits = 0;
    for (const char of address) {
      acc = (acc << 5) | STRKEY_ALPHABET.indexOf(char);
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        const byte = (acc >> bits) & 0xff;
        if (byte === STRKEY_ED25519_VERSION_BYTE) return true;
      }
    }
    return false;
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

/** Upper bound on retained history so a long session cannot grow unbounded. */
const MAX_TRACKED_PAYMENTS = 100;

export class UnifiedPaymentTracker {
  private static history: PaymentResult[] = [];

  public static trackPayment(result: PaymentResult): void {
    this.history.push(result);
    if (this.history.length > MAX_TRACKED_PAYMENTS) {
      this.history.splice(0, this.history.length - MAX_TRACKED_PAYMENTS);
    }
  }

  public static getHistory(): PaymentResult[] {
    return [...this.history];
  }

  public static clearHistory(): void {
    this.history = [];
  }

  /** Payments that were recorded as settled, oldest first. */
  public static getSucceeded(): PaymentResult[] {
    return this.history.filter((result) => result.success);
  }

  /** Payments that failed, oldest first. */
  public static getFailed(): PaymentResult[] {
    return this.history.filter((result) => !result.success);
  }
}
