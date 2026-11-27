import { DomainError } from '../shared/errors';

export class MerchantError extends DomainError {
  static notFound(merchantId: string) {
    return new MerchantError('MERCHANT_NOT_FOUND', `Merchant ${merchantId} not found`, { merchantId });
  }
  static invalidState(message: string, details?: Record<string, unknown>) {
    return new MerchantError('MERCHANT_INVALID_STATE', message, details);
  }
}
