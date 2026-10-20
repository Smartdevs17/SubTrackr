/**
 * Tests for regional tax applied at invoice time (issue #1732) and
 * merchant invoice numbering schemes (issue #1738).
 */

import { createInvoiceController } from "../controller/invoiceController";
import { TaxService } from "../../services/billing/taxService";
import type { Pool } from "../../shared/db/connectionPool";
import {
  createInvoiceNumberingService,
  InMemoryInvoiceNumberingStore,
  type InvoiceNumberingService,
} from "../domain/InvoiceNumberingService";

function makePool(): { pool: Pool; queries: Array<{ text: string; params: unknown[] }> } {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const pool = {
    query: jest.fn((text: string, params: unknown[]) => {
      queries.push({ text, params });
      return Promise.resolve({ rows: [] });
    }),
  } as unknown as Pool;
  return { pool, queries };
}

describe("invoice controller — regional tax", () => {
  beforeEach(() => {
    TaxService.clearRegionRates();
  });

  afterAll(() => {
    TaxService.clearRegionRates();
  });

  it("applies the configured region rate when generating an invoice", async () => {
    TaxService.configureRegionRate({ region: "DE", rateBps: 1900, taxType: "vat" });
    const { pool, queries } = makePool();
    const controller = createInvoiceController({ pool });

    const result = await controller.generateInvoice({
      customerName: "Jane Doe",
      customerEmail: "jane@example.com",
      items: [{ description: "Pro Plan", quantity: 1, unitPrice: 100 }],
      region: "DE",
      currency: "EUR",
    });

    expect(result.success).toBe(true);
    const invoice = result.data!.invoice;
    expect(invoice.taxRegion).toBe("DE");
    expect(invoice.taxType).toBe("vat");
    expect(invoice.taxRate).toBe(0.19);
    expect(invoice.taxAmount).toBe(19);
    expect(invoice.total).toBe(119);

    // Region and type are persisted separately from the revenue columns
    expect(queries[0].text).toContain("tax_region");
    expect(queries[0].text).toContain("tax_type");
    expect(queries[0].params).toContain("DE");
    expect(queries[0].params).toContain("vat");
  });

  it("uses the built-in rate for a region without a configured override", async () => {
    const { pool } = makePool();
    const controller = createInvoiceController({ pool });

    const result = await controller.generateInvoice({
      customerName: "Jane Doe",
      customerEmail: "jane@example.com",
      items: [{ description: "Pro Plan", quantity: 1, unitPrice: 100 }],
      region: "FR",
    });

    expect(result.data!.invoice.taxRate).toBe(0.2);
    expect(result.data!.invoice.taxRegion).toBe("FR");
    expect(result.data!.invoice.taxType).toBe("vat");
  });

  it("lets an explicit taxRate win over the region config", async () => {
    TaxService.configureRegionRate({ region: "DE", rateBps: 1900 });
    const { pool } = makePool();
    const controller = createInvoiceController({ pool });

    const result = await controller.generateInvoice({
      customerName: "Jane Doe",
      customerEmail: "jane@example.com",
      items: [{ description: "Pro Plan", quantity: 1, unitPrice: 100 }],
      region: "DE",
      taxRate: 0.05,
    });

    expect(result.data!.invoice.taxRate).toBe(0.05);
    expect(result.data!.invoice.taxRegion).toBe("DE");
  });

  it("records the region but charges no tax for unknown regions", async () => {
    const { pool } = makePool();
    const controller = createInvoiceController({ pool });

    const result = await controller.generateInvoice({
      customerName: "Jane Doe",
      customerEmail: "jane@example.com",
      items: [{ description: "Pro Plan", quantity: 1, unitPrice: 100 }],
      region: "ZZ",
    });

    expect(result.data!.invoice.taxRate).toBe(0);
    expect(result.data!.invoice.taxAmount).toBe(0);
    expect(result.data!.invoice.taxRegion).toBe("ZZ");
  });
});

describe("invoice controller — numbering schemes (#1738)", () => {
  const at2026 = () => new Date(Date.UTC(2026, 2, 15));

  function makeNumbering(): InvoiceNumberingService {
    return createInvoiceNumberingService({
      store: new InMemoryInvoiceNumberingStore(),
      now: at2026,
    });
  }

  const baseBody = {
    customerName: "Jane Doe",
    customerEmail: "jane@example.com",
    items: [{ description: "Pro Plan", quantity: 1, unitPrice: 100 }],
  };

  it("allocates sequential numbers from the merchant's scheme", async () => {
    const { pool } = makePool();
    const controller = createInvoiceController({ pool, numbering: makeNumbering() });

    const first = await controller.generateInvoice({ ...baseBody, merchantId: "merch_a" });
    const second = await controller.generateInvoice({ ...baseBody, merchantId: "merch_a" });

    expect(first.success).toBe(true);
    expect(first.data!.invoice.invoiceNumber).toBe("INV-2026-000001");
    expect(second.data!.invoice.invoiceNumber).toBe("INV-2026-000002");
  });

  it("keeps numbering independent per merchant", async () => {
    const { pool } = makePool();
    const numbering = makeNumbering();
    await numbering.configureScheme("merch_b", { prefix: "ACME", padding: 4, includeYear: false });
    const controller = createInvoiceController({ pool, numbering });

    const forA = await controller.generateInvoice({ ...baseBody, merchantId: "merch_a" });
    const forB = await controller.generateInvoice({ ...baseBody, merchantId: "merch_b" });

    expect(forA.data!.invoice.invoiceNumber).toBe("INV-2026-000001");
    expect(forB.data!.invoice.invoiceNumber).toBe("ACME-0001");
  });

  it("persists the scheme-allocated number", async () => {
    const { pool, queries } = makePool();
    const controller = createInvoiceController({ pool, numbering: makeNumbering() });

    await controller.generateInvoice({ ...baseBody, merchantId: "merch_a" });

    const insert = queries.find((q) => q.text.includes("INSERT INTO invoices"));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain("INV-2026-000001");
  });

  it("falls back to the legacy generator when numbering fails", async () => {
    const { pool } = makePool();
    const numbering: InvoiceNumberingService = {
      getScheme: jest.fn(),
      configureScheme: jest.fn(),
      nextNumber: jest.fn().mockRejectedValue(new Error("store down")),
    };
    const controller = createInvoiceController({ pool, numbering });

    const result = await controller.generateInvoice({ ...baseBody, merchantId: "merch_a" });

    expect(result.success).toBe(true);
    expect(result.data!.invoice.invoiceNumber).toMatch(/^INV-\d{4}-/);
  });

  it("keeps the legacy generator when no merchantId is supplied", async () => {
    const { pool } = makePool();
    const controller = createInvoiceController({ pool, numbering: makeNumbering() });

    const result = await controller.generateInvoice(baseBody);

    expect(result.success).toBe(true);
    expect(result.data!.invoice.invoiceNumber).toMatch(/^INV-\d{4}-/);
  });

  it("keeps the legacy generator when no numbering service is wired in", async () => {
    const { pool } = makePool();
    const controller = createInvoiceController({ pool });

    const result = await controller.generateInvoice({ ...baseBody, merchantId: "merch_a" });

    expect(result.success).toBe(true);
    expect(result.data!.invoice.invoiceNumber).toMatch(/^INV-\d{4}-/);
  });
});
