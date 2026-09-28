/**
 * WireTransferAchPaymentProvider
 *
 * Payment provider for wire transfer and ACH (Automated Clearing House) payments.
 * Supports payment initiation, status tracking, verification, and settlement.
 *
 * Closes #1139
 */

export type PaymentMethod = "wire_transfer" | "ach";

export type PaymentStatus =
  | "pending"
  | "processing"
  | "settled"
  | "failed"
  | "returned"
  | "cancelled";

export interface WireAchPaymentRequest {
  userId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  // ACH-specific
  bankAccount?: {
    accountNumber: string;
    routingNumber: string;
    accountType: "checking" | "savings";
    accountHolderName: string;
  };
  // Wire transfer-specific
  wireDetails?: {
    beneficiaryName: string;
    beneficiaryAddress?: string;
    bankName: string;
    bankAddress?: string;
    swiftCode?: string;
    iban?: string;
  };
  description?: string;
  idempotencyKey?: string;
}

export interface WireAchPaymentRecord {
  id: string;
  userId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  referenceNumber: string;
  bankAccountLast4?: string;
  wireDetails?: Record<string, string>;
  description?: string;
  processingFee: number;
  estimatedSettlementDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentVerificationResult {
  verified: boolean;
  method: PaymentMethod;
  errors: string[];
}

export class WireTransferAchPaymentProvider {
  // ACH typically 0.8% capped at $5; wire transfer typically $25 flat
  private readonly ACH_FEE_RATE = 0.008;
  private readonly ACH_FEE_CAP = 5;
  private readonly WIRE_FEE_FLAT = 25;

  // ACH settlement: 3-5 business days; Wire: 1-2 business days
  private readonly ACH_SETTLEMENT_DAYS = 4;
  private readonly WIRE_SETTLEMENT_DAYS = 2;

  /**
   * Validate a payment request before processing.
   */
  verifyPaymentRequest(request: WireAchPaymentRequest): PaymentVerificationResult {
    const errors: string[] = [];

    if (!request.userId) errors.push("userId is required");
    if (!request.subscriptionId) errors.push("subscriptionId is required");
    if (request.amount <= 0) errors.push("amount must be positive");
    if (!request.currency) errors.push("currency is required");

    if (request.method === "ach") {
      if (!request.bankAccount) {
        errors.push("bankAccount details are required for ACH payments");
      } else {
        if (!request.bankAccount.accountNumber || request.bankAccount.accountNumber.length < 4) {
          errors.push("valid bank account number is required (min 4 digits)");
        }
        if (!request.bankAccount.routingNumber || !/^\d{9}$/.test(request.bankAccount.routingNumber)) {
          errors.push("valid 9-digit routing number is required");
        }
        if (!request.bankAccount.accountHolderName) {
          errors.push("account holder name is required");
        }
      }
    } else if (request.method === "wire_transfer") {
      if (!request.wireDetails) {
        errors.push("wireDetails are required for wire transfer payments");
      } else {
        if (!request.wireDetails.beneficiaryName) {
          errors.push("beneficiary name is required");
        }
        if (!request.wireDetails.bankName) {
          errors.push("bank name is required");
        }
        if (!request.wireDetails.swiftCode && !request.wireDetails.iban) {
          errors.push("either SWIFT code or IBAN is required");
        }
      }
    } else {
      errors.push(`unsupported payment method: ${request.method}`);
    }

    return { verified: errors.length === 0, method: request.method, errors };
  }

  /**
   * Calculate processing fee based on method and amount.
   */
  calculateFee(method: PaymentMethod, amount: number): number {
    if (method === "ach") {
      return Math.min(amount * this.ACH_FEE_RATE, this.ACH_FEE_CAP);
    }
    return this.WIRE_FEE_FLAT;
  }

  /**
   * Estimate settlement date based on payment method.
   */
  estimateSettlementDate(method: PaymentMethod, from: Date = new Date()): Date {
    const days = method === "ach" ? this.ACH_SETTLEMENT_DAYS : this.WIRE_SETTLEMENT_DAYS;
    const settlement = new Date(from);
    let added = 0;
    while (added < days) {
      settlement.setDate(settlement.getDate() + 1);
      const day = settlement.getDay();
      if (day !== 0 && day !== 6) added++; // skip weekends
    }
    return settlement;
  }

  /**
   * Generate a unique reference number for tracking.
   */
  generateReferenceNumber(method: PaymentMethod): string {
    const prefix = method === "ach" ? "ACH" : "WIR";
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
  }

  /**
   * Process a wire transfer or ACH payment.
   * Returns the payment record with pending status.
   */
  processPayment(request: WireAchPaymentRequest): WireAchPaymentRecord {
    const verification = this.verifyPaymentRequest(request);
    if (!verification.verified) {
      throw new Error(`Payment verification failed: ${verification.errors.join(", ")}`);
    }

    const now = new Date();
    const fee = this.calculateFee(request.method, request.amount);
    const settlementDate = this.estimateSettlementDate(request.method, now);
    const referenceNumber = this.generateReferenceNumber(request.method);

    return {
      id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      userId: request.userId,
      subscriptionId: request.subscriptionId,
      amount: request.amount,
      currency: request.currency,
      method: request.method,
      status: "pending",
      referenceNumber,
      bankAccountLast4:
        request.method === "ach" && request.bankAccount
          ? request.bankAccount.accountNumber.slice(-4)
          : undefined,
      wireDetails: request.method === "wire_transfer" && request.wireDetails
        ? { ...request.wireDetails } as unknown as Record<string, string>
        : undefined,
      description: request.description,
      processingFee: Math.round(fee * 100) / 100,
      estimatedSettlementDate: settlementDate.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  /**
   * Update payment status (e.g., from bank webhook).
   */
  updatePaymentStatus(
    record: WireAchPaymentRecord,
    newStatus: PaymentStatus,
  ): WireAchPaymentRecord {
    const validTransitions: Record<PaymentStatus, PaymentStatus[]> = {
      pending: ["processing", "cancelled", "failed"],
      processing: ["settled", "failed", "returned"],
      settled: [],
      failed: [],
      returned: ["processing"],
      cancelled: [],
    };

    if (!validTransitions[record.status].includes(newStatus)) {
      throw new Error(
        `Invalid status transition: ${record.status} → ${newStatus}`,
      );
    }

    return {
      ...record,
      status: newStatus,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Mask sensitive bank account data for display.
   */
  maskAccountNumber(accountNumber: string): string {
    if (accountNumber.length <= 4) return "****";
    return `****${accountNumber.slice(-4)}`;
  }
}
