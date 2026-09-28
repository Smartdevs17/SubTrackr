/**
 * Tests for GiftCardService
 * Closes #1122
 */

import { GiftCardService, type CreateGiftCardParams, type GiftCard } from "../domain/GiftCardService";

describe("GiftCardService", () => {
  const service = new GiftCardService();

  const validParams: CreateGiftCardParams = {
    type: "subscription_credit",
    value: 50,
    currency: "USD",
    purchaserId: "user-1",
    recipientEmail: "recipient@example.com",
    recipientName: "Jane Doe",
    message: "Happy birthday!",
  };

  describe("generateCode", () => {
    it("generates a code with SUB prefix and 4 segments", () => {
      const code = service.generateCode();
      expect(code).toMatch(/^SUB-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    });

    it("generates unique codes", () => {
      const codes = new Set<string>();
      for (let i = 0; i < 100; i++) codes.add(service.generateCode());
      expect(codes.size).toBeGreaterThan(90); // Most should be unique
    });
  });

  describe("isValidCodeFormat", () => {
    it("validates correct format", () => {
      expect(service.isValidCodeFormat("SUB-ABCD-EFGH-JKLM-NPQR")).toBe(true);
    });

    it("rejects incorrect format", () => {
      expect(service.isValidCodeFormat("INVALID")).toBe(false);
      expect(service.isValidCodeFormat("SUB-ABC-EFGH-JKLM-NPQR")).toBe(false);
    });
  });

  describe("createGiftCard", () => {
    it("creates a valid subscription_credit gift card", () => {
      const card = service.createGiftCard(validParams);
      expect(card.status).toBe("active");
      expect(card.type).toBe("subscription_credit");
      expect(card.value).toBe(50);
      expect(service.isValidCodeFormat(card.code)).toBe(true);
    });

    it("creates a plan_upgrade gift card", () => {
      const card = service.createGiftCard({
        ...validParams,
        type: "plan_upgrade",
        value: 0,
        planId: "premium-monthly",
      });
      expect(card.type).toBe("plan_upgrade");
      expect(card.planId).toBe("premium-monthly");
    });

    it("creates a discount gift card", () => {
      const card = service.createGiftCard({
        ...validParams,
        type: "discount",
        value: 20,
      });
      expect(card.type).toBe("discount");
      expect(card.value).toBe(20);
    });

    it("sets expiry date", () => {
      const card = service.createGiftCard(validParams);
      const expiry = new Date(card.expiresAt);
      const now = new Date();
      const diffDays = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(360);
      expect(diffDays).toBeLessThan(370);
    });

    it("throws on invalid value", () => {
      expect(() => service.createGiftCard({ ...validParams, value: 0 })).toThrow();
      expect(() => service.createGiftCard({ ...validParams, value: -10 })).toThrow();
    });

    it("throws on missing purchaserId", () => {
      expect(() => service.createGiftCard({ ...validParams, purchaserId: "" })).toThrow();
    });

    it("throws on missing recipientEmail", () => {
      expect(() => service.createGiftCard({ ...validParams, recipientEmail: "" })).toThrow();
    });

    it("throws on plan_upgrade without planId", () => {
      expect(() => service.createGiftCard({ ...validParams, type: "plan_upgrade", value: 0 })).toThrow();
    });

    it("throws on discount value > 100", () => {
      expect(() => service.createGiftCard({ ...validParams, type: "discount", value: 150 })).toThrow();
    });
  });

  describe("createGiftCards (batch)", () => {
    it("creates multiple gift cards", () => {
      const cards = service.createGiftCards({ ...validParams, quantity: 5 });
      expect(cards).toHaveLength(5);
      const codes = cards.map((c) => c.code);
      expect(new Set(codes).size).toBe(5); // All unique
    });

    it("caps at 100", () => {
      const cards = service.createGiftCards({ ...validParams, quantity: 200 });
      expect(cards).toHaveLength(100);
    });
  });

  describe("redeemGiftCard", () => {
    it("redeems an active gift card", () => {
      const card = service.createGiftCard(validParams);
      const result = service.redeemGiftCard(card, "user-2", "sub-123");
      expect(result.success).toBe(true);
      expect(result.giftCard?.status).toBe("redeemed");
      expect(result.giftCard?.redeemedBy).toBe("user-2");
      expect(result.appliedValue).toBe(50);
    });

    it("rejects already redeemed card", () => {
      const card = service.createGiftCard(validParams);
      service.redeemGiftCard(card, "user-2");
      const result = service.redeemGiftCard(card, "user-3");
      expect(result.success).toBe(false);
      expect(result.error).toContain("already been redeemed");
    });

    it("rejects expired card", () => {
      const card = service.createGiftCard({ ...validParams, expiresInDays: -1 });
      const result = service.redeemGiftCard(card, "user-2");
      expect(result.success).toBe(false);
      expect(result.error).toContain("expired");
    });

    it("returns upgradedPlan for plan_upgrade type", () => {
      const card = service.createGiftCard({
        ...validParams,
        type: "plan_upgrade",
        value: 0,
        planId: "premium-monthly",
      });
      const result = service.redeemGiftCard(card, "user-2");
      expect(result.success).toBe(true);
      expect(result.upgradedPlan).toBe("premium-monthly");
    });
  });

  describe("checkBalance", () => {
    it("returns balance for active card", () => {
      const card = service.createGiftCard(validParams);
      const balance = service.checkBalance(card);
      expect(balance.status).toBe("active");
      expect(balance.value).toBe(50);
      expect(balance.isExpired).toBe(false);
    });

    it("detects expired cards", () => {
      const card = service.createGiftCard({ ...validParams, expiresInDays: -1 });
      const balance = service.checkBalance(card);
      expect(balance.isExpired).toBe(true);
      expect(balance.status).toBe("expired");
    });
  });

  describe("cancelGiftCard", () => {
    it("cancels an active gift card", () => {
      const card = service.createGiftCard(validParams);
      const cancelled = service.cancelGiftCard(card);
      expect(cancelled.status).toBe("cancelled");
    });

    it("throws on redeemed card", () => {
      const card = service.createGiftCard(validParams);
      service.redeemGiftCard(card, "user-2");
      expect(() => service.cancelGiftCard(card)).toThrow();
    });
  });

  describe("buildGiftMessage", () => {
    it("builds a message with card details", () => {
      const card = service.createGiftCard(validParams);
      const message = service.buildGiftMessage(card);
      expect(message).toContain("gift card");
      expect(message).toContain(card.code);
      expect(message).toContain("$50");
      expect(message).toContain("Happy birthday!");
    });
  });
});
