/**
 * GiftCardService
 *
 * Manages subscription gift cards and redeem codes.
 * Supports gift card creation, redemption, balance tracking, and expiry.
 *
 * Closes #1122
 */

import crypto from "node:crypto";

export type GiftCardStatus = "active" | "redeemed" | "expired" | "cancelled";
export type GiftCardType = "subscription_credit" | "plan_upgrade" | "discount";

export interface GiftCard {
  id: string;
  code: string;
  type: GiftCardType;
  status: GiftCardStatus;
  // For subscription_credit: the dollar value
  // For plan_upgrade: the plan ID to upgrade to
  // For discount: the discount percentage (0-100)
  value: number;
  currency: string;
  planId?: string;

  // Purchaser / recipient
  purchaserId: string;
  recipientEmail: string;
  recipientName?: string;
  message?: string;

  // Redemption
  redeemedBy?: string;
  redeemedAt?: string;
  redemptionSubscriptionId?: string;

  // Lifecycle
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface RedeemCode {
  id: string;
  code: string;
  giftCardId: string;
  used: boolean;
  usedBy?: string;
  usedAt?: string;
  createdAt: string;
}

export interface CreateGiftCardParams {
  type: GiftCardType;
  value: number;
  currency?: string;
  planId?: string;
  purchaserId: string;
  recipientEmail: string;
  recipientName?: string;
  message?: string;
  expiresInDays?: number;
  quantity?: number;
}

export interface RedeemResult {
  success: boolean;
  giftCard?: GiftCard;
  error?: string;
  appliedValue?: number;
  upgradedPlan?: string;
}

export class GiftCardService {
  private readonly CODE_LENGTH = 16;
  private readonly CODE_PREFIX = "SUB";
  private readonly DEFAULT_EXPIRY_DAYS = 365;

  /**
   * Generate a unique gift card code.
   * Format: SUB-XXXX-XXXX-XXXX-XXXX (alphanumeric, uppercase)
   */
  generateCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No ambiguous chars
    const segments: string[] = [];
    for (let s = 0; s < 4; s++) {
      let segment = "";
      for (let i = 0; i < 4; i++) {
        segment += chars[Math.floor(Math.random() * chars.length)];
      }
      segments.push(segment);
    }
    return `${this.CODE_PREFIX}-${segments.join("-")}`;
  }

  /**
   * Generate a short redeem code (8 chars).
   */
  generateRedeemCode(): string {
    return crypto.randomBytes(6).toString("hex").toUpperCase().slice(0, 8);
  }

  /**
   * Validate a gift card code format.
   */
  isValidCodeFormat(code: string): boolean {
    return /^SUB-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code);
  }

  /**
   * Create a single gift card.
   */
  createGiftCard(params: CreateGiftCardParams): GiftCard {
    if (params.value <= 0) {
      throw new Error("Gift card value must be positive");
    }
    if (!params.purchaserId) {
      throw new Error("Purchaser ID is required");
    }
    if (!params.recipientEmail) {
      throw new Error("Recipient email is required");
    }
    if (params.type === "plan_upgrade" && !params.planId) {
      throw new Error("planId is required for plan_upgrade type");
    }
    if (params.type === "discount" && (params.value < 0 || params.value > 100)) {
      throw new Error("Discount value must be between 0 and 100");
    }

    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + (params.expiresInDays ?? this.DEFAULT_EXPIRY_DAYS));

    return {
      id: `gc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      code: this.generateCode(),
      type: params.type,
      status: "active",
      value: params.value,
      currency: params.currency ?? "USD",
      planId: params.planId,
      purchaserId: params.purchaserId,
      recipientEmail: params.recipientEmail,
      recipientName: params.recipientName,
      message: params.message,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  /**
   * Create multiple gift cards at once (batch purchase).
   */
  createGiftCards(params: CreateGiftCardParams): GiftCard[] {
    const quantity = Math.min(params.quantity ?? 1, 100);
    const cards: GiftCard[] = [];
    for (let i = 0; i < quantity; i++) {
      cards.push(this.createGiftCard(params));
    }
    return cards;
  }

  /**
   * Redeem a gift card code.
   */
  redeemGiftCard(
    giftCard: GiftCard,
    redeemedBy: string,
    subscriptionId?: string,
  ): RedeemResult {
    // Check if already redeemed
    if (giftCard.status === "redeemed") {
      return { success: false, error: "Gift card has already been redeemed" };
    }

    // Check if expired
    if (giftCard.status === "expired" || new Date(giftCard.expiresAt) < new Date()) {
      return { success: false, error: "Gift card has expired" };
    }

    // Check if cancelled
    if (giftCard.status === "cancelled") {
      return { success: false, error: "Gift card has been cancelled" };
    }

    // Check if active
    if (giftCard.status !== "active") {
      return { success: false, error: `Gift card is not active (status: ${giftCard.status})` };
    }

    if (!redeemedBy) {
      return { success: false, error: "Redeemer ID is required" };
    }

    const now = new Date().toISOString();
    const redeemed: GiftCard = {
      ...giftCard,
      status: "redeemed",
      redeemedBy,
      redeemedAt: now,
      redemptionSubscriptionId: subscriptionId,
      updatedAt: now,
    };

    const result: RedeemResult = {
      success: true,
      giftCard: redeemed,
    };

    if (giftCard.type === "subscription_credit") {
      result.appliedValue = giftCard.value;
    } else if (giftCard.type === "plan_upgrade") {
      result.upgradedPlan = giftCard.planId;
    } else if (giftCard.type === "discount") {
      result.appliedValue = giftCard.value;
    }

    return result;
  }

  /**
   * Check gift card balance / status.
   */
  checkBalance(giftCard: GiftCard): {
    status: GiftCardStatus;
    value: number;
    type: GiftCardType;
    expiresAt: string;
    isExpired: boolean;
  } {
    const isExpired = new Date(giftCard.expiresAt) < new Date();
    return {
      status: isExpired && giftCard.status === "active" ? "expired" : giftCard.status,
      value: giftCard.value,
      type: giftCard.type,
      expiresAt: giftCard.expiresAt,
      isExpired,
    };
  }

  /**
   * Cancel a gift card (only if not yet redeemed).
   */
  cancelGiftCard(giftCard: GiftCard): GiftCard {
    if (giftCard.status === "redeemed") {
      throw new Error("Cannot cancel a redeemed gift card");
    }
    return {
      ...giftCard,
      status: "cancelled",
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Create redeem codes for a gift card (for distribution).
   */
  createRedeemCodes(giftCardId: string, count: number = 1): RedeemCode[] {
    const codes: RedeemCode[] = [];
    const now = new Date().toISOString();
    for (let i = 0; i < Math.min(count, 10); i++) {
      codes.push({
        id: `rc_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        code: this.generateRedeemCode(),
        giftCardId,
        used: false,
        createdAt: now,
      });
    }
    return codes;
  }

  /**
   * Generate a personalized gift message.
   */
  buildGiftMessage(giftCard: GiftCard): string {
    const parts = [
      `You have received a SubTrackr gift card!`,
      ``,
      `Type: ${giftCard.type.replace(/_/g, " ")}`,
    ];

    if (giftCard.type === "subscription_credit") {
      parts.push(`Value: ${giftCard.currency === "USD" ? "$" : ""}${giftCard.value}`);
    } else if (giftCard.type === "plan_upgrade") {
      parts.push(`Plan: ${giftCard.planId ?? "Premium"}`);
    } else if (giftCard.type === "discount") {
      parts.push(`Discount: ${giftCard.value}%`);
    }

    parts.push(`Code: ${giftCard.code}`, `Expires: ${new Date(giftCard.expiresAt).toLocaleDateString()}`);

    if (giftCard.message) {
      parts.push(``, `Message: ${giftCard.message}`);
    }

    return parts.join("\n");
  }
}
