import { DomainError } from '../shared/errors';
import { ErrorCode } from '../shared/apiResponse';

/**
 * Billing module error codes.
 * All codes follow pattern: BILL_[CATEGORY]_[SPECIFIC]
 */
export const BillingErrorCode = {
  INVOICE_NOT_FOUND: 'BILL_INVOICE_NOT_FOUND' as ErrorCode,
  PAYMENT_FAILED: 'BILL_PAYMENT_FAILED' as ErrorCode,
  TAX_CALCULATION_FAILED: 'BILL_TAX_CALCULATION_FAILED' as ErrorCode,
  METERING_FAILED: 'BILL_METERING_FAILED' as ErrorCode,
  PRICING_FAILED: 'BILL_PRICING_FAILED' as ErrorCode,
  DUNNING_FAILED: 'BILL_DUNNING_FAILED' as ErrorCode,
  RECONCILIATION_FAILED: 'BILL_RECONCILIATION_FAILED' as ErrorCode,
  EXPORT_FAILED: 'BILL_EXPORT_FAILED' as ErrorCode,
  OVERAGE_EXCEEDED: 'BILL_OVERAGE_EXCEEDED' as ErrorCode,
  INVALID_PLAN: 'BILL_INVALID_PLAN' as ErrorCode,
  // Credit-specific codes — kept here so HTTP handlers can map them to
  // status codes without reaching into the service implementation.
  CREDIT_INVALID_AMOUNT: 'BILL_CREDIT_INVALID_AMOUNT' as ErrorCode,
  CREDIT_INSUFFICIENT: 'BILL_CREDIT_INSUFFICIENT' as ErrorCode,
  CREDIT_SELF_TRANSFER: 'BILL_CREDIT_SELF_TRANSFER' as ErrorCode,
  CREDIT_EXPIRED: 'BILL_CREDIT_EXPIRED' as ErrorCode,
  WALLET_NOT_FOUND: 'BILL_WALLET_NOT_FOUND' as ErrorCode,
} as const;

export class BillingError extends DomainError {
  static paymentFailed(subscriptionId: string, reason: string): BillingError {
    return new BillingError(
      BillingErrorCode.PAYMENT_FAILED,
      `Payment failed for subscription ${subscriptionId}: ${reason}`,
      { subscriptionId, reason }
    );
  }

  static taxCalculationFailed(merchantId: string, reason: string): BillingError {
    return new BillingError(
      BillingErrorCode.TAX_CALCULATION_FAILED,
      `Tax calculation failed for merchant ${merchantId}: ${reason}`,
      { merchantId, reason }
    );
  }

  static dunningFailed(subscriptionId: string, stage: string): BillingError {
    return new BillingError(
      BillingErrorCode.DUNNING_FAILED,
      `Dunning failed for subscription ${subscriptionId} at stage ${stage}`,
      { subscriptionId, stage }
    );
  }

  static creditInvalidAmount(reason: string): BillingError {
    return new BillingError(
      BillingErrorCode.CREDIT_INVALID_AMOUNT,
      `Credit amount invalid: ${reason}`,
      { reason }
    );
  }

  static creditInsufficient(accountId: string, attempted: number, available: number): BillingError {
    return new BillingError(
      BillingErrorCode.CREDIT_INSUFFICIENT,
      `Account ${accountId} has insufficient credit: requested ${attempted}, available ${available}`,
      { accountId, attempted: String(attempted), available: String(available) }
    );
  }

  static creditSelfTransfer(accountId: string): BillingError {
    return new BillingError(
      BillingErrorCode.CREDIT_SELF_TRANSFER,
      `Account ${accountId} cannot transfer credit to itself`,
      { accountId }
    );
  }

  static walletNotFound(walletId: number): BillingError {
    return new BillingError(
      BillingErrorCode.WALLET_NOT_FOUND,
      `Prepayment wallet ${walletId} not found`,
      { walletId: String(walletId) }
    );
  }
}
