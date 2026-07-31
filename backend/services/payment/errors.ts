import { DomainError } from '../shared/errors';
import { ErrorCode } from '../shared/apiResponse';

export const PaymentErrorCode = {
  GATEWAY_NOT_FOUND: 'PAYMENT_GATEWAY_NOT_FOUND' as ErrorCode,
  GATEWAY_ERROR: 'PAYMENT_GATEWAY_ERROR' as ErrorCode,
  GATEWAY_FALLBACK_FAILED: 'PAYMENT_GATEWAY_FALLBACK_FAILED' as ErrorCode,
  GATEWAY_CONFIG_INVALID: 'PAYMENT_GATEWAY_CONFIG_INVALID' as ErrorCode,
  REFUND_PARTIAL_FAILED: 'PAYMENT_REFUND_PARTIAL_FAILED' as ErrorCode,
} as const;

export class PaymentError extends DomainError {
  constructor(code: ErrorCode, message: string, details?: Record<string, string>) {
    super(code, message, details);
  }

  static gatewayNotFound(gateway: string): PaymentError {
    return new PaymentError(PaymentErrorCode.GATEWAY_NOT_FOUND, `Payment gateway not found: ${gateway}`, { gateway });
  }

  static gatewayError(gateway: string, reason: string): PaymentError {
    return new PaymentError(PaymentErrorCode.GATEWAY_ERROR, `Gateway ${gateway} error: ${reason}`, { gateway, reason });
  }

  static fallbackFailed(primary: string, secondary: string): PaymentError {
    return new PaymentError(PaymentErrorCode.GATEWAY_FALLBACK_FAILED, `Fallback from ${primary} to ${secondary} failed`, { primary, secondary });
  }
}
