/**
 * Tests for tax exemption handling at invoice time (issue #1740).
 */

import { createInvoiceController } from "../controller/invoiceController";
import { TaxService } from "../../services/billing/taxService";
import type { Pool } from "../../shared/db/connectionPool";
import {
  createTaxExemptionService,
  InMemoryCustomerTaxStatusStore,
  type TaxExemptionService,
} from "../../services/billing/taxExemptionService";
import { HashChainService, AuditWriter } from "../../audit/domain";
import { SensitiveOpsAuditController } from "../../audit/controller/sensitiveOpsAuditController";

function makePool(rows: unknown[] = []): {
  pool: Pool;
  queries: Array<{ text: string; params: unknown[] }>;
} {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const pool = {
    query: jest.fn((text: string, params: unknown[]) => {
      queries.push({ text, params });
      return Promise.resolve({ rows });
    }),
  } as unknown as Pool;
  return { pool, queries };
}

function makeTaxExemptions(): TaxExemptionService {
  const chain = new HashChainService();
  const auditController = new SensitiveOpsAuditController(new AuditWriter(chain));
  return createTaxExemptionService({
    store: new InMemoryCustomerTaxStatusStore(),
    auditController,
    auditChain: chain,
  });
}

const baseBody = {
  customerName: "Jane Doe",
  customerEmail: "jane@example.com",
  items: [{ description: "Pro Plan", quantity: 1, unitPrice: 100 }],
};

describe("invoice controller — tax exemptions (#1740)", () => {
  beforeEach(() => {
    TaxService.clearRegionRates();
  });

  afterAll(() => {
    TaxService.clearRegionRates();
  });

  it("charges no tax for an exempt customer and records the exemption", async () => {
    TaxService.configureRegionRate({ region: "DE", rateBps: 1900, taxType: "vat" });
    const taxExemptions = makeTaxExemptions();
    await taxExemptions.set("cust-1", { isExempt: true, reason: "cert on file" });

    const { pool, queries } = makePool();
    const controller = createInvoiceController({ pool, taxExemptions });

    const result = await controller.generateInvoice({ ...baseBody, region: "DE", customerId: "cust-1" });

    expect(result.success).toBe(true);
    const invoice = result.data!.invoice;
    expect(invoice.isTaxExempt).toBe(true);
    expect(invoice.taxRate).toBe(0);
    expect(invoice.taxAmount).toBe(0);
    expect(invoice.total).toBe(100);
    // The jurisdiction is still recorded even though no tax was charged.
    expect(invoice.taxRegion).toBe("DE");

    const insert = queries.find((q) => q.text.includes("INSERT INTO invoices"));
    expect(insert!.text).toContain("is_tax_exempt");
    expect(insert!.params).toContain(true);
  });

  it("lets the exemption win over an explicit tax rate", async () => {
    const taxExemptions = makeTaxExemptions();
    await taxExemptions.set("cust-2", { isExempt: true, reason: "cert on file" });
    const { pool } = makePool();
    const controller = createInvoiceController({ pool, taxExemptions });

    const result = await controller.generateInvoice({
      ...baseBody,
      region: "DE",
      taxRate: 0.05,
      customerId: "cust-2",
    });

    expect(result.data!.invoice.taxRate).toBe(0);
    expect(result.data!.invoice.taxAmount).toBe(0);
  });

  it("still taxes an exempt customer in a jurisdiction they are not exempt for", async () => {
    const taxExemptions = makeTaxExemptions();
    await taxExemptions.set("cust-3", {
      isExempt: true,
      reason: "US only",
      exemptJurisdictions: ["US-CA"],
    });
    const { pool } = makePool();
    const controller = createInvoiceController({ pool, taxExemptions });

    const result = await controller.generateInvoice({ ...baseBody, region: "DE", customerId: "cust-3" });

    expect(result.data!.invoice.isTaxExempt).toBe(false);
    expect(result.data!.invoice.taxAmount).toBeGreaterThan(0);
  });

  it("treats an expired exempt certificate as taxable", async () => {
    const taxExemptions = makeTaxExemptions();
    await taxExemptions.set("cust-4", {
      isExempt: true,
      reason: "expired",
      certificateExpiry: Date.now() - 1_000,
    });
    const { pool } = makePool();
    const controller = createInvoiceController({ pool, taxExemptions });

    const result = await controller.generateInvoice({ ...baseBody, region: "DE", customerId: "cust-4" });

    expect(result.data!.invoice.isTaxExempt).toBe(false);
    expect(result.data!.invoice.taxRate).toBe(0.19);
  });

  it("falls back to the customer email when no customerId is supplied", async () => {
    const taxExemptions = makeTaxExemptions();
    await taxExemptions.set("jane@example.com", { isExempt: true, reason: "cert on file" });
    const { pool } = makePool();
    const controller = createInvoiceController({ pool, taxExemptions });

    const result = await controller.generateInvoice({ ...baseBody, region: "DE" });

    expect(result.data!.invoice.isTaxExempt).toBe(true);
    expect(result.data!.invoice.total).toBe(100);
  });

  it("falls back to the region rate when the exemption lookup fails", async () => {
    TaxService.configureRegionRate({ region: "DE", rateBps: 1900 });
    const taxExemptions: TaxExemptionService = {
      get: jest.fn(),
      set: jest.fn(),
      isExempt: jest.fn().mockRejectedValue(new Error("store down")),
      listAudit: jest.fn(),
    };
    const { pool } = makePool();
    const controller = createInvoiceController({ pool, taxExemptions });

    const result = await controller.generateInvoice({ ...baseBody, region: "DE", customerId: "cust-5" });

    expect(result.success).toBe(true);
    expect(result.data!.invoice.isTaxExempt).toBe(false);
    expect(result.data!.invoice.taxRate).toBe(0.19);
  });

  it("leaves behaviour unchanged when no exemption service is wired in", async () => {
    TaxService.configureRegionRate({ region: "DE", rateBps: 1900 });
    const { pool } = makePool();
    const controller = createInvoiceController({ pool });

    const result = await controller.generateInvoice({ ...baseBody, region: "DE", customerId: "cust-1" });

    expect(result.data!.invoice.isTaxExempt).toBe(false);
    expect(result.data!.invoice.taxRate).toBe(0.19);
  });
});
