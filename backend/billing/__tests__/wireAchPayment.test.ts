/**
 * Tests for WireTransferAchPaymentProvider
 * Closes #1139
 */

import { WireTransferAchPaymentProvider, type WireAchPaymentRequest } from "../domain/WireTransferAchPaymentProvider";

describe("WireTransferAchPaymentProvider", () => {
  const provider = new WireTransferAchPaymentProvider();

  const validAchRequest: WireAchPaymentRequest = {
    userId: "user-1",
    subscriptionId: "sub-1",
    amount: 100,
    currency: "USD",
    method: "ach",
    bankAccount: {
      accountNumber: "123456789",
      routingNumber: "021000021",
      accountType: "checking",
      accountHolderName: "John Doe",
    },
  };

  const validWireRequest: WireAchPaymentRequest = {
    userId: "user-1",
    subscriptionId: "sub-1",
    amount: 5000,
    currency: "USD",
    method: "wire_transfer",
    wireDetails: {
      beneficiaryName: "John Doe",
      bankName: "Chase Bank",
      swiftCode: "CHASUS33",
    },
  };

  describe("verifyPaymentRequest", () => {
    it("verifies a valid ACH request", () => {
      const result = provider.verifyPaymentRequest(validAchRequest);
      expect(result.verified).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("verifies a valid wire transfer request", () => {
      const result = provider.verifyPaymentRequest(validWireRequest);
      expect(result.verified).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("rejects ACH without bank account", () => {
      const result = provider.verifyPaymentRequest({ ...validAchRequest, bankAccount: undefined });
      expect(result.verified).toBe(false);
    });

    it("rejects ACH with invalid routing number", () => {
      const result = provider.verifyPaymentRequest({
        ...validAchRequest,
        bankAccount: { ...validAchRequest.bankAccount!, routingNumber: "123" },
      });
      expect(result.verified).toBe(false);
    });

    it("rejects wire without SWIFT or IBAN", () => {
      const result = provider.verifyPaymentRequest({
        ...validWireRequest,
        wireDetails: { beneficiaryName: "John", bankName: "Chase" },
      });
      expect(result.verified).toBe(false);
    });

    it("rejects negative amount", () => {
      const result = provider.verifyPaymentRequest({ ...validAchRequest, amount: -50 });
      expect(result.verified).toBe(false);
    });
  });

  describe("calculateFee", () => {
    it("calculates ACH fee with cap", () => {
      expect(provider.calculateFee("ach", 100)).toBe(0.8);
      expect(provider.calculateFee("ach", 10000)).toBe(5); // capped at $5
    });

    it("calculates wire transfer flat fee", () => {
      expect(provider.calculateFee("wire_transfer", 100)).toBe(25);
      expect(provider.calculateFee("wire_transfer", 100000)).toBe(25);
    });
  });

  describe("estimateSettlementDate", () => {
    it("estimates ACH settlement in ~4 business days", () => {
      const monday = new Date("2026-09-28"); // Monday
      const settlement = provider.estimateSettlementDate("ach", monday);
      // 4 business days from Mon = Fri Oct 2
      expect(settlement.getDay()).not.toBe(0); // not Sunday
      expect(settlement.getDay()).not.toBe(6); // not Saturday
    });

    it("estimates wire settlement in ~2 business days", () => {
      const monday = new Date("2026-09-28");
      const settlement = provider.estimateSettlementDate("wire_transfer", monday);
      expect(settlement.getDay()).not.toBe(0);
      expect(settlement.getDay()).not.toBe(6);
    });
  });

  describe("processPayment", () => {
    it("processes a valid ACH payment", () => {
      const payment = provider.processPayment(validAchRequest);
      expect(payment.status).toBe("pending");
      expect(payment.method).toBe("ach");
      expect(payment.referenceNumber).toMatch(/^ACH-/);
      expect(payment.bankAccountLast4).toBe("6789");
    });

    it("processes a valid wire transfer payment", () => {
      const payment = provider.processPayment(validWireRequest);
      expect(payment.status).toBe("pending");
      expect(payment.method).toBe("wire_transfer");
      expect(payment.referenceNumber).toMatch(/^WIR-/);
    });

    it("throws on invalid request", () => {
      expect(() => provider.processPayment({ ...validAchRequest, amount: 0 })).toThrow();
    });
  });

  describe("updatePaymentStatus", () => {
    it("allows pending → processing", () => {
      const payment = provider.processPayment(validAchRequest);
      const updated = provider.updatePaymentStatus(payment, "processing");
      expect(updated.status).toBe("processing");
    });

    it("allows processing → settled", () => {
      const payment = provider.processPayment(validAchRequest);
      const processing = provider.updatePaymentStatus(payment, "processing");
      const settled = provider.updatePaymentStatus(processing, "settled");
      expect(settled.status).toBe("settled");
    });

    it("rejects invalid transition settled → pending", () => {
      const payment = provider.processPayment(validAchRequest);
      const processing = provider.updatePaymentStatus(payment, "processing");
      const settled = provider.updatePaymentStatus(processing, "settled");
      expect(() => provider.updatePaymentStatus(settled, "pending")).toThrow();
    });
  });

  describe("maskAccountNumber", () => {
    it("masks account number showing last 4", () => {
      expect(provider.maskAccountNumber("123456789")).toBe("****6789");
    });

    it("masks short account numbers", () => {
      expect(provider.maskAccountNumber("123")).toBe("****");
    });
  });
});
