/**
 * Gift Card Controller
 *
 * REST endpoints for gift card and redeem code management.
 * Closes #1122
 */

import type { Pool } from "../../shared/db/connectionPool";
import {
  GiftCardService,
  type CreateGiftCardParams,
  type GiftCard,
  type RedeemResult,
} from "../domain/GiftCardService";

export interface GiftCardControllerDeps {
  pool: Pool;
}

export function createGiftCardController(deps: GiftCardControllerDeps) {
  const service = new GiftCardService();

  return {
    /**
     * POST /gift-cards
     * Create one or more gift cards.
     */
    async createGiftCard(
      body: CreateGiftCardParams,
    ): Promise<{ success: boolean; data?: GiftCard[]; status?: number; error?: string }> {
      try {
        if (!body.type || !body.purchaserId || !body.recipientEmail) {
          return { success: false, status: 400, error: "type, purchaserId, and recipientEmail are required" };
        }

        const cards = service.createGiftCards(body);

        // Persist to database
        for (const card of cards) {
          await deps.pool.query(
            `INSERT INTO gift_cards
             (id, code, type, status, value, currency, plan_id, purchaser_id,
              recipient_email, recipient_name, message, expires_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              card.id, card.code, card.type, card.status, card.value, card.currency,
              card.planId ?? null, card.purchaserId, card.recipientEmail,
              card.recipientName ?? null, card.message ?? null, card.expiresAt,
              card.createdAt, card.updatedAt,
            ],
          );
        }

        return { success: true, data: cards };
      } catch (err) {
        console.error("[GiftCard] Error creating gift card:", err);
        return {
          success: false,
          status: err instanceof Error && err.message.includes("required") ? 400 : 500,
          error: err instanceof Error ? err.message : "Failed to create gift card",
        };
      }
    },

    /**
     * POST /gift-cards/redeem
     * Redeem a gift card by code.
     */
    async redeemGiftCard(
      body: { code: string; redeemedBy: string; subscriptionId?: string },
    ): Promise<{ success: boolean; data?: RedeemResult; status?: number; error?: string }> {
      try {
        if (!body.code || !body.redeemedBy) {
          return { success: false, status: 400, error: "code and redeemedBy are required" };
        }

        const result = await deps.pool.query(
          `SELECT * FROM gift_cards WHERE code = $1`,
          [body.code.toUpperCase()],
        );

        if (result.rows.length === 0) {
          return { success: false, status: 404, error: "Gift card not found" };
        }

        const giftCard = result.rows[0] as unknown as GiftCard;
        const redeemResult = service.redeemGiftCard(giftCard, body.redeemedBy, body.subscriptionId);

        if (redeemResult.success && redeemResult.giftCard) {
          await deps.pool.query(
            `UPDATE gift_cards
             SET status = $1, redeemed_by = $2, redeemed_at = $3,
                 redemption_subscription_id = $4, updated_at = $5
             WHERE id = $6`,
            [
              redeemResult.giftCard.status, body.redeemedBy,
              redeemResult.giftCard.redeemedAt, body.subscriptionId ?? null,
              redeemResult.giftCard.updatedAt, giftCard.id,
            ],
          );
        }

        return { success: true, data: redeemResult };
      } catch (err) {
        console.error("[GiftCard] Error redeeming gift card:", err);
        return { success: false, status: 500, error: "Failed to redeem gift card" };
      }
    },

    /**
     * GET /gift-cards/:code
     * Check gift card balance / status.
     */
    async checkBalance(
      code: string,
    ): Promise<{ success: boolean; data?: unknown; status?: number; error?: string }> {
      try {
        const result = await deps.pool.query(
          `SELECT * FROM gift_cards WHERE code = $1`,
          [code.toUpperCase()],
        );

        if (result.rows.length === 0) {
          return { success: false, status: 404, error: "Gift card not found" };
        }

        const giftCard = result.rows[0] as unknown as GiftCard;
        const balance = service.checkBalance(giftCard);
        return { success: true, data: balance };
      } catch (err) {
        return { success: false, status: 500, error: "Failed to check balance" };
      }
    },

    /**
     * GET /gift-cards
     * List gift cards for a purchaser.
     */
    async listGiftCards(
      purchaserId: string,
    ): Promise<{ success: boolean; data?: GiftCard[]; status?: number; error?: string }> {
      try {
        const result = await deps.pool.query(
          `SELECT * FROM gift_cards WHERE purchaser_id = $1 ORDER BY created_at DESC`,
          [purchaserId],
        );
        return { success: true, data: result.rows as unknown as GiftCard[] };
      } catch (err) {
        return { success: false, status: 500, error: "Failed to list gift cards" };
      }
    },

    /**
     * DELETE /gift-cards/:id
     * Cancel a gift card.
     */
    async cancelGiftCard(
      giftCardId: string,
    ): Promise<{ success: boolean; data?: GiftCard; status?: number; error?: string }> {
      try {
        const result = await deps.pool.query(
          `SELECT * FROM gift_cards WHERE id = $1`,
          [giftCardId],
        );

        if (result.rows.length === 0) {
          return { success: false, status: 404, error: "Gift card not found" };
        }

        const giftCard = result.rows[0] as unknown as GiftCard;
        const cancelled = service.cancelGiftCard(giftCard);

        await deps.pool.query(
          `UPDATE gift_cards SET status = $1, updated_at = $2 WHERE id = $3`,
          [cancelled.status, cancelled.updatedAt, giftCardId],
        );

        return { success: true, data: cancelled };
      } catch (err) {
        return {
          success: false,
          status: err instanceof Error && err.message.includes("Cannot") ? 400 : 500,
          error: err instanceof Error ? err.message : "Failed to cancel gift card",
        };
      }
    },

    /**
     * GET /gift-cards/:code/message
     * Get the gift message for display/email.
     */
    async getGiftMessage(
      code: string,
    ): Promise<{ success: boolean; data?: { message: string; giftCard: GiftCard }; status?: number; error?: string }> {
      try {
        const result = await deps.pool.query(
          `SELECT * FROM gift_cards WHERE code = $1`,
          [code.toUpperCase()],
        );

        if (result.rows.length === 0) {
          return { success: false, status: 404, error: "Gift card not found" };
        }

        const giftCard = result.rows[0] as unknown as GiftCard;
        const message = service.buildGiftMessage(giftCard);
        return { success: true, data: { message, giftCard } };
      } catch (err) {
        return { success: false, status: 500, error: "Failed to get gift message" };
      }
    },
  };
}

export type GiftCardController = ReturnType<typeof createGiftCardController>;
