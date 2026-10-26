/**
 * Wire/ACH Payment Controller
 *
 * REST endpoints for wire transfer and ACH payment operations.
 * Closes #1139
 */

import type { Pool } from "../../shared/db/connectionPool";
import {
  WireTransferAchPaymentProvider,
  type WireAchPaymentRequest,
  type WireAchPaymentRecord,
  type PaymentStatus,
} from "../domain/WireTransferAchPaymentProvider";

export interface WireAchPaymentControllerDeps {
  pool: Pool;
}

export function createWireAchPaymentController(deps: WireAchPaymentControllerDeps) {
  const provider = new WireTransferAchPaymentProvider();

  return {
    /**
     * POST /payments/wire-ach
     * Initiate a new wire transfer or ACH payment.
     */
    async initiatePayment(
      request: WireAchPaymentRequest,
    ): Promise<{ success: boolean; data?: WireAchPaymentRecord; status?: number; error?: string }> {
      try {
        const verification = provider.verifyPaymentRequest(request);
        if (!verification.verified) {
          return { success: false, status: 400, error: verification.errors.join("; ") };
        }

        const payment = provider.processPayment(request);

        // Persist to database
        await deps.pool.query(
          `INSERT INTO wire_ach_payments
           (id, user_id, subscription_id, amount, currency, method, status,
            reference_number, bank_account_last4, processing_fee,
            estimated_settlement_date, description, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            payment.id, payment.userId, payment.subscriptionId,
            payment.amount, payment.currency, payment.method, payment.status,
            payment.referenceNumber, payment.bankAccountLast4 ?? null,
            payment.processingFee, payment.estimatedSettlementDate,
            payment.description ?? null, payment.createdAt, payment.updatedAt,
          ],
        );

        return { success: true, data: payment };
      } catch (err) {
        console.error("[WireAchPayment] Error initiating payment:", err);
        return {
          success: false,
          status: err instanceof Error && err.message.includes("verification") ? 400 : 500,
          error: err instanceof Error ? err.message : "Failed to initiate payment",
        };
      }
    },

    /**
     * GET /payments/wire-ach/:id
     * Retrieve a payment by ID.
     */
    async getPayment(
      paymentId: string,
    ): Promise<{ success: boolean; data?: WireAchPaymentRecord; status?: number; error?: string }> {
      try {
        const result = await deps.pool.query(
          `SELECT * FROM wire_ach_payments WHERE id = $1`,
          [paymentId],
        );
        if (result.rows.length === 0) {
          return { success: false, status: 404, error: "Payment not found" };
        }
        return { success: true, data: result.rows[0] as unknown as WireAchPaymentRecord };
      } catch (err) {
        console.error("[WireAchPayment] Error fetching payment:", err);
        return { success: false, status: 500, error: "Failed to fetch payment" };
      }
    },

    /**
     * GET /payments/wire-ach/user/:userId
     * List all wire/ACH payments for a user.
     */
    async listUserPayments(
      userId: string,
    ): Promise<{ success: boolean; data?: WireAchPaymentRecord[]; status?: number; error?: string }> {
      try {
        const result = await deps.pool.query(
          `SELECT * FROM wire_ach_payments WHERE user_id = $1 ORDER BY created_at DESC`,
          [userId],
        );
        return { success: true, data: result.rows as unknown as WireAchPaymentRecord[] };
      } catch (err) {
        console.error("[WireAchPayment] Error listing payments:", err);
        return { success: false, status: 500, error: "Failed to list payments" };
      }
    },

    /**
     * PATCH /payments/wire-ach/:id/status
     * Update payment status (e.g., from bank webhook).
     */
    async updateStatus(
      paymentId: string,
      newStatus: PaymentStatus,
    ): Promise<{ success: boolean; data?: WireAchPaymentRecord; status?: number; error?: string }> {
      try {
        const existing = await deps.pool.query(
          `SELECT * FROM wire_ach_payments WHERE id = $1`,
          [paymentId],
        );
        if (existing.rows.length === 0) {
          return { success: false, status: 404, error: "Payment not found" };
        }

        const current = existing.rows[0] as unknown as WireAchPaymentRecord;
        const updated = provider.updatePaymentStatus(current, newStatus);

        await deps.pool.query(
          `UPDATE wire_ach_payments SET status = $1, updated_at = $2 WHERE id = $3`,
          [updated.status, updated.updatedAt, paymentId],
        );

        return { success: true, data: updated };
      } catch (err) {
        console.error("[WireAchPayment] Error updating status:", err);
        return {
          success: false,
          status: err instanceof Error && err.message.includes("Invalid") ? 400 : 500,
          error: err instanceof Error ? err.message : "Failed to update payment status",
        };
      }
    },

    /**
     * GET /payments/wire-ach/estimate
     * Get fee and settlement estimate for a payment method and amount.
     */
    async getEstimate(
      method: "wire_transfer" | "ach",
      amount: number,
    ): Promise<{ success: boolean; data?: { fee: number; estimatedSettlementDate: string }; status?: number; error?: string }> {
      try {
        const fee = provider.calculateFee(method, amount);
        const settlementDate = provider.estimateSettlementDate(method);
        return {
          success: true,
          data: {
            fee: Math.round(fee * 100) / 100,
            estimatedSettlementDate: settlementDate.toISOString(),
          },
        };
      } catch (err) {
        return { success: false, status: 500, error: "Failed to get estimate" };
      }
    },
  };
}

export type WireAchPaymentController = ReturnType<typeof createWireAchPaymentController>;
