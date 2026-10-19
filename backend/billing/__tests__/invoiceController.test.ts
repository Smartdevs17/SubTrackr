/**
 * Tests for regional tax applied at invoice time (issue #1732).
 */

import { createInvoiceController } from "../controller/invoiceController";
import { TaxService } from "../../services/billing/taxService";
import type { Pool } from "../../shared/db/connectionPool";

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
