/**
 * Tests for the covering-index contract behind GET /invoices (issue #2265).
 * Run with the backend Jest config, or with the Node 26 type-stripping harness.
 */

import {
  InvoiceIndexErrorCode,
  InvoiceIndexError,
  InvoiceListIndexName,
  INVOICE_LIST_COLUMNS,
  INVOICE_LIST_DEFAULT_LIMIT,
  INVOICE_LIST_FILTER_COLUMNS,
  INVOICE_LIST_INDEXES,
  INVOICE_LIST_INDEX_DECLARATIONS,
  INVOICE_LIST_MAX_LIMIT,
  INVOICE_LIST_ORDER_BY,
  INVOICE_LIST_PROJECTION,
  activeFilterColumns,
  buildInvoiceListQuery,
  checkInvoiceListCoverage,
  selectInvoiceListIndex,
  toPrismaIndexDeclaration,
  type InvoiceCoveringIndex,
  type InvoiceListQueryDescriptor,
} from "../invoices.ts";

describe("invoice list projection and index definitions", () => {
  it("projects exactly the eight list columns", () => {
    expect(INVOICE_LIST_PROJECTION).toHaveLength(8);
    expect(INVOICE_LIST_PROJECTION).toEqual([
      "invoice_number", "customer_name", "customer_email", "status",
      "total", "currency", "invoice_date", "due_date",
    ]);
  });

  it("excludes heap-only columns from the projection", () => {
    expect(INVOICE_LIST_PROJECTION).not.toContain("pdf_base64");
    expect(INVOICE_LIST_PROJECTION).not.toContain("subtotal");
    expect(INVOICE_LIST_PROJECTION).not.toContain("tax_rate");
    expect(INVOICE_LIST_PROJECTION).not.toContain("branding");
    expect(INVOICE_LIST_PROJECTION).not.toContain("created_at");
  });

  it("fixes the filter columns and the sort term", () => {
    expect(INVOICE_LIST_FILTER_COLUMNS.customerEmail).toBe("customer_email");
    expect(INVOICE_LIST_FILTER_COLUMNS.status).toBe("status");
    expect(INVOICE_LIST_ORDER_BY).toEqual([{ column: "created_at", direction: "DESC" }]);
    expect(INVOICE_LIST_DEFAULT_LIMIT).toBe(50);
    expect(INVOICE_LIST_MAX_LIMIT).toBe(100);
  });

  it("declares three covering indexes, each carrying the whole projection", () => {
    expect(INVOICE_LIST_INDEXES).toHaveLength(3);
    for (const index of INVOICE_LIST_INDEXES) {
      for (const column of INVOICE_LIST_PROJECTION) {
        expect(index.keyColumns).toContain(column);
      }
      expect(index.keyColumns).toContain("created_at");
      expect(index.sortDirection).toBe("DESC");
    }
  });

  it("selects the expected index for every filter shape", () => {
    expect(selectInvoiceListIndex({}).name).toBe(InvoiceListIndexName.RECENT);
    expect(selectInvoiceListIndex({ customerEmail: "a@b.c" }).name).toBe(InvoiceListIndexName.CUSTOMER);
    expect(selectInvoiceListIndex({ status: "paid" }).name).toBe(InvoiceListIndexName.STATUS);
    expect(selectInvoiceListIndex({ customerEmail: "a@b.c", status: "paid" }).name).toBe(InvoiceListIndexName.CUSTOMER);
  });

  it("renders the Prisma declarations used in schema.prisma", () => {
    expect(INVOICE_LIST_INDEX_DECLARATIONS).toHaveLength(3);
    expect(INVOICE_LIST_INDEX_DECLARATIONS[0]).toBe(
      '@@index([created_at(sort: Desc), invoice_number, customer_name, customer_email, status, total, currency, invoice_date, due_date], name: "idx_invoices_list_recent_covering")',
    );
    expect(INVOICE_LIST_INDEX_DECLARATIONS[1]).toBe(
      '@@index([customer_email, created_at(sort: Desc), invoice_number, customer_name, status, total, currency, invoice_date, due_date], name: "idx_invoices_list_customer_covering")',
    );
    expect(INVOICE_LIST_INDEX_DECLARATIONS[2]).toBe(
      '@@index([status, created_at(sort: Desc), invoice_number, customer_name, customer_email, total, currency, invoice_date, due_date], name: "idx_invoices_list_status_covering")',
    );
    expect(toPrismaIndexDeclaration(INVOICE_LIST_INDEXES[0] as InvoiceCoveringIndex)).toContain("sort: Desc");
  });
});

describe("coverage validation", () => {
  const descriptor: InvoiceListQueryDescriptor = {
    filters: { customerEmail: "a@b.c" },
    projection: INVOICE_LIST_PROJECTION,
    orderBy: INVOICE_LIST_ORDER_BY,
    limit: 25,
  };

  it("accepts the canonical descriptor against its index", () => {
    const result = checkInvoiceListCoverage(descriptor, INVOICE_LIST_INDEXES[1] as InvoiceCoveringIndex);
    expect(result.covered).toBe(true);
    expect(result.reasons).toHaveLength(0);
    expect(result.index).toBe(InvoiceListIndexName.CUSTOMER);
  });

  it("rejects projection drift and reports why", () => {
    const drifted: InvoiceListQueryDescriptor = {
      ...descriptor,
      projection: [...INVOICE_LIST_PROJECTION, "pdf_base64"],
    };
    const result = checkInvoiceListCoverage(drifted, INVOICE_LIST_INDEXES[1] as InvoiceCoveringIndex);
    expect(result.covered).toBe(false);
    expect(result.reasons).toContain("projection must exactly match the covering index projection");
  });

  it("rejects a missing projected column", () => {
    const short: InvoiceListQueryDescriptor = {
      ...descriptor,
      projection: INVOICE_LIST_PROJECTION.slice(0, 7),
    };
    expect(checkInvoiceListCoverage(short, INVOICE_LIST_INDEXES[1] as InvoiceCoveringIndex).covered).toBe(false);
  });

  it("rejects a sort that disagrees with the index", () => {
    const ascending: InvoiceListQueryDescriptor = {
      ...descriptor,
      orderBy: [{ column: "created_at", direction: "ASC" }],
    };
    const result = checkInvoiceListCoverage(ascending, INVOICE_LIST_INDEXES[1] as InvoiceCoveringIndex);
    expect(result.covered).toBe(false);
    expect(result.reasons).toContain("orderBy must be exactly created_at DESC");
  });

  it("rejects an index missing the ordered key", () => {
    const brokenIndex: InvoiceCoveringIndex = {
      ...INVOICE_LIST_INDEXES[1] as InvoiceCoveringIndex,
      keyColumns: ["invoice_number", "status"],
    };
    const result = checkInvoiceListCoverage(descriptor, brokenIndex);
    expect(result.covered).toBe(false);
    expect(result.reasons).toContain("created_at is not a key of the index");
    expect(result.reasons).toContain("filter column customer_email is not a key of the index");
  });

  it("rejects an ASC index and an out-of-range limit", () => {
    const ascIndex: InvoiceCoveringIndex = {
      ...INVOICE_LIST_INDEXES[1] as InvoiceCoveringIndex,
      sortDirection: "ASC",
    };
    expect(checkInvoiceListCoverage(descriptor, ascIndex).reasons).toContain("index sort direction is not DESC");

    const bigLimit: InvoiceListQueryDescriptor = { ...descriptor, limit: 101 };
    expect(checkInvoiceListCoverage(bigLimit, INVOICE_LIST_INDEXES[1] as InvoiceCoveringIndex).covered).toBe(false);
  });

  it("orders active filter columns canonically", () => {
    expect(activeFilterColumns({})).toEqual([]);
    expect(activeFilterColumns({ status: "paid", customerEmail: "a@b.c" })).toEqual(["customer_email", "status"]);
  });
});

describe("index-aligned query builder", () => {
  it("builds the unfiltered page against the recent covering index", () => {
    const query = buildInvoiceListQuery();
    expect(query.index).toBe(InvoiceListIndexName.RECENT);
    expect(query.params).toEqual([50]);
    expect(query.text).toContain("SELECT invoice_number, customer_name, customer_email, status, total, currency, invoice_date, due_date FROM invoices");
    expect(query.text).toContain("ORDER BY created_at DESC LIMIT $1");
    expect(query.text).not.toContain("WHERE");
    expect(query.text).not.toContain("SELECT *");
  });

  it("builds the customer_email filtered page", () => {
    const query = buildInvoiceListQuery({ customerEmail: "  a@b.c  " });
    expect(query.index).toBe(InvoiceListIndexName.CUSTOMER);
    expect(query.text).toContain("WHERE customer_email = $1");
    expect(query.params).toEqual(["a@b.c", 50]);
    expect(query.text).toContain("LIMIT $2");
  });

  it("builds the status filtered page", () => {
    const query = buildInvoiceListQuery({ status: "paid" });
    expect(query.index).toBe(InvoiceListIndexName.STATUS);
    expect(query.text).toContain("WHERE status = $1");
    expect(query.params).toEqual(["paid", 50]);
  });

  it("builds the combined filter page with both equality predicates", () => {
    const query = buildInvoiceListQuery({ customerEmail: "a@b.c", status: "paid", limit: 10 });
    expect(query.index).toBe(InvoiceListIndexName.CUSTOMER);
    expect(query.text).toContain("WHERE customer_email = $1 AND status = $2");
    expect(query.params).toEqual(["a@b.c", "paid", 10]);
    expect(query.text).toContain("LIMIT $3");
  });

  it("clamps oversized limits and keeps small ones", () => {
    expect(buildInvoiceListQuery({ limit: 250 }).params).toEqual([100]);
    expect(buildInvoiceListQuery({ limit: 1 }).params).toEqual([1]);
    expect(buildInvoiceListQuery({ limit: 12.9 }).params).toEqual([12]);
  });

  it("never wraps an indexed column in a function", () => {
    const query = buildInvoiceListQuery({ status: "paid" });
    expect(query.text).not.toContain("LOWER(");
    expect(query.text).not.toContain("COALESCE(");
    expect(query.text).not.toContain("DATE(");
  });

  it("rejects invalid filters and limits with stable codes", () => {
    expect(() => buildInvoiceListQuery({ customerEmail: "" }))
      .toThrow(InvoiceIndexError);
    expect(() => buildInvoiceListQuery({ status: "   " }))
      .toThrow(InvoiceIndexError);
    expect(() => buildInvoiceListQuery({ limit: 0 }))
      .toThrow(InvoiceIndexError);
    expect(() => buildInvoiceListQuery({ limit: Number.NaN }))
      .toThrow(InvoiceIndexError);

    try {
      buildInvoiceListQuery({ customerEmail: "" });
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as InvoiceIndexError).code).toBe(InvoiceIndexErrorCode.INVALID_FILTER);
      expect((error as InvoiceIndexError).name).toBe("InvoiceIndexError");
    }
  });

  it("emits the selected index to the observability hook", () => {
    const seen: Array<{ index: string; filterColumns: readonly string[]; limit: number }> = [];
    buildInvoiceListQuery(
      { status: "paid", limit: 7 },
      { onIndexSelected: (selection) => seen.push({
        index: selection.index,
        filterColumns: selection.filterColumns,
        limit: selection.limit,
      }) },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.index).toBe(InvoiceListIndexName.STATUS);
    expect(seen[0]?.filterColumns).toEqual(["status"]);
    expect(seen[0]?.limit).toBe(7);
  });

  it("exposes the canonical column names", () => {
    expect(INVOICE_LIST_COLUMNS.createdAt).toBe("created_at");
    expect(INVOICE_LIST_COLUMNS.invoiceNumber).toBe("invoice_number");
    expect(INVOICE_LIST_COLUMNS.customerEmail).toBe("customer_email");
  });
});
