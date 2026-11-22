/**
 * Frontend token payment service — thin client that delegates to the backend
 * multi-chain token payment API.
 *
 * Issue #2213: Multi-chain token payment strategy for ERC20 and Soroban.
 *
 * The frontend does not sign transactions (keys live in the wallet provider);
 * this service prepares a `TokenPaymentRequest`, asks the wallet to sign, and
 * forwards the signed transaction to the backend for settlement.
 */

import type {
  TokenPaymentRequest,
  TokenPaymentResult,
  TokenRefundRequest,
  TokenRefundResult,
  TokenBalanceQuery,
  TokenBalanceResult,
  ChainType,
} from '../../backend/services/payment/domain/tokenPaymentStrategy';

/** Injectable HTTP client for the backend token-payment endpoints. */
export interface TokenPaymentHttpClient {
  post(path: string, body: unknown): Promise<unknown>;
  get(path: string): Promise<unknown>;
}

const DEFAULT_BASE_PATH = '/api/payments/tokens';

/**
 * Prepares a token payment request from subscription details.
 *
 * The caller supplies the subscription's billing info plus the payer's wallet
 * address; this helper fills in the chain type and returns a request ready for
 * signing.
 */
export function buildTokenPaymentRequest(params: {
  subscriptionId: string;
  from: string;
  to: string;
  amount: string;
  tokenAddress: string;
  tokenSymbol: string;
  chainId: string;
  chainType: ChainType;
  memo?: string;
  merchantId?: string;
}): TokenPaymentRequest {
  if (!params.from) throw new Error('Payer address (from) is required');
  if (!params.to) throw new Error('Recipient address (to) is required');
  if (!params.amount || BigInt(params.amount) <= 0n) {
    throw new Error('Amount must be a positive integer');
  }
  if (!params.tokenAddress) throw new Error('Token address is required');
  if (!params.chainId) throw new Error('Chain id is required');

  return {
    paymentId: `tp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    subscriptionId: params.subscriptionId,
    from: params.from,
    to: params.to,
    amount: params.amount,
    tokenAddress: params.tokenAddress,
    tokenSymbol: params.tokenSymbol,
    chainId: params.chainId,
    chainType: params.chainType,
    memo: params.memo,
    merchantId: params.merchantId,
  };
}

export class TokenPaymentService {
  private static instance: TokenPaymentService;

  private constructor(
    private httpClient: TokenPaymentHttpClient,
    private basePath: string = DEFAULT_BASE_PATH,
  ) {}

  static getInstance(httpClient?: TokenPaymentHttpClient): TokenPaymentService {
    if (!TokenPaymentService.instance) {
      const client: TokenPaymentHttpClient =
        httpClient ??
        {
          post: async (path: string, body: unknown) => {
            const res = await fetch(path, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            return res.json();
          },
          get: async (path: string) => {
            const res = await fetch(path);
            return res.json();
          },
        };
      TokenPaymentService.instance = new TokenPaymentService(client);
    }
    return TokenPaymentService.instance;
  }

  /** Reset singleton — for tests. */
  static reset(): void {
    TokenPaymentService.instance = undefined as unknown as TokenPaymentService;
  }

  static createWithClient(httpClient: TokenPaymentHttpClient, basePath?: string): TokenPaymentService {
    return new TokenPaymentService(httpClient, basePath ?? DEFAULT_BASE_PATH);
  }

  async charge(request: TokenPaymentRequest): Promise<TokenPaymentResult> {
    return this.httpClient.post(`${this.basePath}/charge`, request) as Promise<TokenPaymentResult>;
  }

  async refund(request: TokenRefundRequest): Promise<TokenRefundResult> {
    return this.httpClient.post(`${this.basePath}/refund`, request) as Promise<TokenRefundResult>;
  }

  async getBalance(query: TokenBalanceQuery): Promise<TokenBalanceResult> {
    const qs = new URLSearchParams({
      address: query.address,
      tokenAddress: query.tokenAddress,
      chainId: query.chainId,
      chainType: query.chainType,
    });
    return this.httpClient.get(`${this.basePath}/balance?${qs}`) as Promise<TokenBalanceResult>;
  }
}

export const tokenPaymentService = TokenPaymentService.getInstance();
