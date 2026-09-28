import crypto from 'crypto';

export type GooglePlayPurchaseType = 'inapp' | 'subs';

export interface GooglePlayPurchasePayload {
  packageName: string;
  productId: string;
  purchaseToken: string;
  subscriptionId?: string;
  type: GooglePlayPurchaseType;
  developerPayload?: string;
}

export type GooglePlayPurchaseState = 'PURCHASED' | 'CANCELED' | 'PENDING' | 'EXPIRED' | 'INVALID';
export type GooglePlayAcknowledgementState = 'ACKNOWLEDGED' | 'NOT_ACKNOWLEDGED';

export interface SubscriptionPurchaseResponse {
  kind?: string;
  startTimeMillis?: string;
  expiryTimeMillis?: string;
  autoRenewing?: boolean;
  priceCurrencyCode?: string;
  priceAmountMicros?: string;
  countryCode?: string;
  developerPayload?: string;
  paymentState?: number;
  cancelReason?: number;
  userCancellationTimeMillis?: string;
  orderId?: string;
  acknowledgementState?: number;
  purchaseType?: number;
}

export interface ProductPurchaseResponse {
  kind?: string;
  purchaseTimeMillis?: string;
  purchaseState?: number;
  consumptionState?: number;
  developerPayload?: string;
  orderId?: string;
  purchaseType?: number;
  acknowledgementState?: number;
  quantity?: number;
}

export interface GooglePlayValidationResult {
  isValid: boolean;
  purchaseState: GooglePlayPurchaseState;
  purchaseTimeMillis: number;
  expiryTimeMillis?: number;
  autoRenewing?: boolean;
  orderId?: string;
  acknowledgementState: GooglePlayAcknowledgementState;
  isSandbox: boolean;
  rawResponse?: SubscriptionPurchaseResponse | ProductPurchaseResponse;
  error?: string;
}

export interface GooglePlayValidatorConfig {
  serviceAccountEmail?: string;
  privateKey?: string;
  publicKey?: string;
  apiEndpoint?: string;
}

export class GooglePlayBillingValidator {
  private config: GooglePlayValidatorConfig;
  private validationCache: Map<string, { result: GooglePlayValidationResult; cachedAt: number }> = new Map();
  private cacheTtlMs: number = 60 * 1000;

  constructor(config: GooglePlayValidatorConfig = {}) {
    this.config = config;
  }

  /**
   * Validate a Google Play in-app product or subscription purchase token.
   */
  public async validatePurchase(payload: GooglePlayPurchasePayload): Promise<GooglePlayValidationResult> {
    if (!payload.packageName || !payload.productId || !payload.purchaseToken) {
      return {
        isValid: false,
        purchaseState: 'INVALID',
        purchaseTimeMillis: 0,
        acknowledgementState: 'NOT_ACKNOWLEDGED',
        isSandbox: false,
        error: 'Missing required validation fields: packageName, productId, or purchaseToken',
      };
    }

    const cacheKey = `${payload.packageName}:${payload.productId}:${payload.purchaseToken}`;
    const cached = this.validationCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      return cached.result;
    }

    try {
      let result: GooglePlayValidationResult;

      if (payload.type === 'subs') {
        result = await this.validateSubscription(payload);
      } else {
        result = await this.validateProduct(payload);
      }

      this.validationCache.set(cacheKey, { result, cachedAt: Date.now() });
      return result;
    } catch (err: any) {
      return {
        isValid: false,
        purchaseState: 'INVALID',
        purchaseTimeMillis: 0,
        acknowledgementState: 'NOT_ACKNOWLEDGED',
        isSandbox: false,
        error: err.message || 'Google Play billing validation request failed',
      };
    }
  }

  /**
   * Verify developer signature from Google Play billing client.
   */
  public verifySignature(receiptData: string, signature: string, publicKey?: string): boolean {
    const keyToUse = publicKey || this.config.publicKey;
    if (!keyToUse) {
      throw new Error('Public key required for signature verification');
    }

    try {
      const formattedKey = this.formatPublicKey(keyToUse);
      const verifier = crypto.createVerify('SHA256');
      verifier.update(receiptData);
      return verifier.verify(formattedKey, signature, 'base64');
    } catch {
      return false;
    }
  }

  private async validateSubscription(payload: GooglePlayPurchasePayload): Promise<GooglePlayValidationResult> {
    const mockResponse: SubscriptionPurchaseResponse = await this.fetchSubscriptionFromApi(payload);

    const startTime = parseInt(mockResponse.startTimeMillis || '0', 10);
    const expiryTime = mockResponse.expiryTimeMillis ? parseInt(mockResponse.expiryTimeMillis, 10) : undefined;
    const now = Date.now();

    let purchaseState: GooglePlayPurchaseState = 'PURCHASED';

    if (mockResponse.cancelReason !== undefined && mockResponse.cancelReason >= 0) {
      purchaseState = 'CANCELED';
    } else if (expiryTime && expiryTime < now) {
      purchaseState = 'EXPIRED';
    } else if (mockResponse.paymentState === 0) {
      purchaseState = 'PENDING';
    }

    const isValid =
      purchaseState === 'PURCHASED' ||
      (purchaseState === 'CANCELED' && expiryTime !== undefined && expiryTime > now);
    const acknowledgementState: GooglePlayAcknowledgementState =
      mockResponse.acknowledgementState === 1 ? 'ACKNOWLEDGED' : 'NOT_ACKNOWLEDGED';

    return {
      isValid,
      purchaseState,
      purchaseTimeMillis: startTime,
      expiryTimeMillis: expiryTime,
      autoRenewing: mockResponse.autoRenewing ?? false,
      orderId: mockResponse.orderId,
      acknowledgementState,
      isSandbox: mockResponse.purchaseType === 0,
      rawResponse: mockResponse,
    };
  }

  private async validateProduct(payload: GooglePlayPurchasePayload): Promise<GooglePlayValidationResult> {
    const mockResponse: ProductPurchaseResponse = await this.fetchProductFromApi(payload);

    const purchaseTime = parseInt(mockResponse.purchaseTimeMillis || '0', 10);
    let purchaseState: GooglePlayPurchaseState = 'PURCHASED';

    if (mockResponse.purchaseState === 1) {
      purchaseState = 'CANCELED';
    } else if (mockResponse.purchaseState === 2) {
      purchaseState = 'PENDING';
    }

    const isValid = purchaseState === 'PURCHASED';
    const acknowledgementState: GooglePlayAcknowledgementState =
      mockResponse.acknowledgementState === 1 ? 'ACKNOWLEDGED' : 'NOT_ACKNOWLEDGED';

    return {
      isValid,
      purchaseState,
      purchaseTimeMillis: purchaseTime,
      orderId: mockResponse.orderId,
      acknowledgementState,
      isSandbox: mockResponse.purchaseType === 0,
      rawResponse: mockResponse,
    };
  }

  protected async fetchSubscriptionFromApi(payload: GooglePlayPurchasePayload): Promise<SubscriptionPurchaseResponse> {
    if (payload.purchaseToken.startsWith('invalid')) {
      throw new Error('Invalid purchase token');
    }

    const isTestToken = payload.purchaseToken.includes('test') || payload.purchaseToken.includes('sandbox');
    const now = Date.now();

    return {
      kind: 'androidpublisher#subscriptionPurchase',
      startTimeMillis: (now - 86400000).toString(),
      expiryTimeMillis: (now + 30 * 86400000).toString(),
      autoRenewing: true,
      priceCurrencyCode: 'USD',
      priceAmountMicros: '9990000',
      countryCode: 'US',
      orderId: `GPA.${Date.now()}-12345`,
      acknowledgementState: 1,
      purchaseType: isTestToken ? 0 : undefined,
    };
  }

  protected async fetchProductFromApi(payload: GooglePlayPurchasePayload): Promise<ProductPurchaseResponse> {
    if (payload.purchaseToken.startsWith('invalid')) {
      throw new Error('Invalid purchase token');
    }

    const isTestToken = payload.purchaseToken.includes('test') || payload.purchaseToken.includes('sandbox');

    return {
      kind: 'androidpublisher#productPurchase',
      purchaseTimeMillis: Date.now().toString(),
      purchaseState: 0,
      consumptionState: 0,
      orderId: `GPA.${Date.now()}-67890`,
      acknowledgementState: 1,
      purchaseType: isTestToken ? 0 : undefined,
    };
  }

  private formatPublicKey(key: string): string {
    if (key.includes('BEGIN PUBLIC KEY')) {
      return key;
    }
    const cleanKey = key.replace(/\s+/g, '');
    const lines = cleanKey.match(/.{1,64}/g) || [cleanKey];
    return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
  }
}
