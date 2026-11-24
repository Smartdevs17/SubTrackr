/**
 * backend/src/services/invoices.ts
 *
 * Covering-index contract for the invoices list query (issue #2265).
 *
 * GET /invoices projects eight columns, optionally filters on customer_email
 * and/or status, and always orders by created_at DESC. The three covering
 * indexes declared in backend/prisma/schema.prisma carry that whole shape in
 * their keys, so the endpoint is served as an index-only scan: no Sort node,
 * and no heap lookup for any projected column.
 *
 * This module is the single, testable source of truth for that contract. It is
 * pure — no I/O, no clock, no ambient state — so the query shape and the index
 * definitions can be pinned by unit tests without a database.
 */

/** Stable machine-readable codes emitted by this module. */
export const InvoiceIndexErrorCode = {
  INVALID_FILTER: "INVALID_FILTER",
  INVALID_LIMIT: "INVALID_LIMIT",
  UNSUPPORTED_PROJECTION: "UNSUPPORTED_PROJECTION",
  NO_COVERING_INDEX: "NO_COVERING_INDEX",
} as const;

export type InvoiceIndexErrorCode = (typeof InvoiceIndexErrorCode)[keyof typeof InvoiceIndexErrorCode];

/** Typed error for a filter, limit or query shape the covering indexes cannot serve. */
export class InvoiceIndexError extends Error {
  readonly code: InvoiceIndexErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: InvoiceIndexErrorCode, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = "InvoiceIndexError";
    this.code = code;
    this.details = details;
  }
}

/** Index names, identical to the `@name` arguments in schema.prisma. */
export const InvoiceListIndexName = {
  RECENT: "idx_invoices_list_recent_covering",
  CUSTOMER: "idx_invoices_list_customer_covering",
  STATUS: "idx_invoices_list_status_covering",
} as const;

export type InvoiceListIndexName = (typeof InvoiceListIndexName)[keyof typeof InvoiceListIndexName];

/** Physical column names of the invoices table used by the list query. */
export const INVOICE_LIST_COLUMNS = Object.freeze({
  invoiceNumber: "invoice_number",
  customerName: "customer_name",
  customerEmail: "customer_email",
  status: "status",
  total: "total",
  currency: "currency",
  invoiceDate: "invoice_date",
  dueDate: "due_date",
  createdAt: "created_at",
} as const);

/** A single ORDER BY term. */
export interface InvoiceOrderTerm {
  readonly column: string;
  readonly direction: "ASC" | "DESC";
}

/** Exactly the eight columns GET /invoices returns. Adding one breaks covering. */
export const INVOICE_LIST_PROJECTION: readonly string[] = Object.freeze([
  INVOICE_LIST_COLUMNS.invoiceNumber,
  INVOICE_LIST_COLUMNS.customerName,
  INVOICE_LIST_COLUMNS.customerEmail,
  INVOICE_LIST_COLUMNS.status,
  INVOICE_LIST_COLUMNS.total,
  INVOICE_LIST_COLUMNS.currency,
  INVOICE_LIST_COLUMNS.invoiceDate,
  INVOICE_LIST_COLUMNS.dueDate,
]);

/** Optional equality filters supported by the endpoint. */
export const INVOICE_LIST_FILTER_COLUMNS = Object.freeze({
  customerEmail: INVOICE_LIST_COLUMNS.customerEmail,
  status: INVOICE_LIST_COLUMNS.status,
} as const);

/** The single sort term every covering index is keyed for. */
export const INVOICE_LIST_ORDER_BY: readonly InvoiceOrderTerm[] = Object.freeze([
  Object.freeze({ column: INVOICE_LIST_COLUMNS.createdAt, direction: "DESC" as const }),
]);

export const INVOICE_LIST_DEFAULT_LIMIT = 50;
export const INVOICE_LIST_MAX_LIMIT = 100;

/** One covering index, mirroring an `@@index([...])` entry in schema.prisma. */
export interface InvoiceCoveringIndex {
  readonly name: InvoiceListIndexName;
  /** Equality column served by the leading key; null for the unfiltered page. */
  readonly equalityFilter: "customer_email" | "status" | null;
  /** Physical key order. created_at follows the equality key (or leads when unfiltered). */
  readonly keyColumns: readonly string[];
  /** Sort direction applied to the created_at key. */
  readonly sortDirection: "ASC" | "DESC";
}

/**
 * Canonical covering indexes. Each key list is the full projection followed by
 * the ordered created_at key, in the same order as schema.prisma. The equality
 * filter is the leading key where one exists, so a filtered list is a narrow
 * ordered range scan instead of a scan-and-sort of the whole table.
 */
export const INVOICE_LIST_INDEXES: readonly InvoiceCoveringIndex[] = Object.freeze([
  Object.freeze({
    name: InvoiceListIndexName.RECENT,
    equalityFilter: null,
    keyColumns: Object.freeze([
      "created_at", "invoice_number", "customer_name", "customer_email",
      "status", "total", "currency", "invoice_date", "due_date",
    ]),
    sortDirection: "DESC" as const,
  }),
  Object.freeze({
    name: InvoiceListIndexName.CUSTOMER,
    equalityFilter: INVOICE_LIST_FILTER_COLUMNS.customerEmail,
    keyColumns: Object.freeze([
      "customer_email", "created_at", "invoice_number", "customer_name",
      "status", "total", "currency", "invoice_date", "due_date",
    ]),
    sortDirection: "DESC" as const,
  }),
  Object.freeze({
    name: InvoiceListIndexName.STATUS,
    equalityFilter: INVOICE_LIST_FILTER_COLUMNS.status,
    keyColumns: Object.freeze([
      "status", "created_at", "invoice_number", "customer_name",
      "customer_email", "total", "currency", "invoice_date", "due_date",
    ]),
    sortDirection: "DESC" as const,
  }),
]);

/** The subset of filters the endpoint applies as SQL equality predicates. */
export interface InvoiceListFilterValues {
  readonly customerEmail?: string;
  readonly status?: string;
}

/** Public filter/limit input of the list endpoint. */
export interface InvoiceListFilters extends InvoiceListFilterValues {
  readonly limit?: number;
}

/** Pure description of a list query, used for coverage validation. */
export interface InvoiceListQueryDescriptor {
  readonly filters: InvoiceListFilterValues;
  readonly projection: readonly string[];
  readonly orderBy: readonly InvoiceOrderTerm[];
  readonly limit: number;
}

/** Result of checking a descriptor against one covering index. */
export interface InvoiceCoverageResult {
  readonly covered: boolean;
  readonly index: InvoiceListIndexName;
  readonly reasons: readonly string[];
}

/** Selection metadata handed to the optional observability hook. */
export interface InvoiceListIndexSelection {
  readonly index: InvoiceListIndexName;
  readonly filterColumns: readonly string[];
  readonly projection: readonly string[];
  readonly limit: number;
}

/** Optional metrics/logging hook; the module never performs I/O itself. */
export interface InvoiceListQueryOptions {
  readonly onIndexSelected?: (selection: InvoiceListIndexSelection) => void;
}

/** The parameterized SQL produced for the list endpoint. */
export interface InvoiceListQuery {
  readonly text: string;
  readonly params: readonly (string | number)[];
  readonly index: InvoiceListIndexName;
}

/** Filter columns currently active, in canonical SQL order. */
export function activeFilterColumns(filters: InvoiceListFilterValues): readonly string[] {
  const columns: string[] = [];
  if (filters.customerEmail !== undefined) columns.push(INVOICE_LIST_FILTER_COLUMNS.customerEmail);
  if (filters.status !== undefined) columns.push(INVOICE_LIST_FILTER_COLUMNS.status);
  return Object.freeze(columns);
}

/** Look up a canonical index by name. */
function indexByName(name: InvoiceListIndexName): InvoiceCoveringIndex {
  const found = INVOICE_LIST_INDEXES.find((entry) => entry.name === name);
  if (found === undefined) {
    throw new InvoiceIndexError(InvoiceIndexErrorCode.NO_COVERING_INDEX, "Unknown covering index", { name });
  }
  return found;
}

/**
 * Pick the narrowest covering index for a filter shape. customer_email is the
 * leading key for the customer (and combined) path because it is the more
 * selective equality predicate; both filters remain index-only in that path.
 */
export function selectInvoiceListIndex(filters: InvoiceListFilterValues): InvoiceCoveringIndex {
  if (filters.customerEmail !== undefined) return indexByName(InvoiceListIndexName.CUSTOMER);
  if (filters.status !== undefined) return indexByName(InvoiceListIndexName.STATUS);
  return indexByName(InvoiceListIndexName.RECENT);
}

/**
 * Validate that a query descriptor is fully served by the given index.
 * Every projected/filtered column must be an index key and the sort must be
 * the index's created_at DESC key; otherwise the database would need a heap
 * fetch or a Sort node and the optimization would silently regress.
 */
export function checkInvoiceListCoverage(
  descriptor: InvoiceListQueryDescriptor,
  index: InvoiceCoveringIndex,
): InvoiceCoverageResult {
  const reasons: string[] = [];

  const projection = descriptor.projection;
  if (
    projection.length !== INVOICE_LIST_PROJECTION.length ||
    projection.some((column, i) => column !== INVOICE_LIST_PROJECTION[i])
  ) {
    reasons.push("projection must exactly match the covering index projection");
  }

  const orderBy = descriptor.orderBy;
  if (
    orderBy.length !== INVOICE_LIST_ORDER_BY.length ||
    orderBy.some(
      (term, i) =>
        term.column !== INVOICE_LIST_ORDER_BY[i]?.column ||
        term.direction !== INVOICE_LIST_ORDER_BY[i]?.direction,
    )
  ) {
    reasons.push("orderBy must be exactly created_at DESC");
  }

  if (!index.keyColumns.includes(INVOICE_LIST_COLUMNS.createdAt)) {
    reasons.push("created_at is not a key of the index");
  }
  if (index.sortDirection !== "DESC") {
    reasons.push("index sort direction is not DESC");
  }
  for (const column of projection) {
    if (!index.keyColumns.includes(column)) {
      reasons.push("projected column " + column + " is not covered by the index");
    }
  }
  for (const column of activeFilterColumns(descriptor.filters)) {
    if (!index.keyColumns.includes(column)) {
      reasons.push("filter column " + column + " is not a key of the index");
    }
  }
  if (!Number.isInteger(descriptor.limit) || descriptor.limit < 1 || descriptor.limit > INVOICE_LIST_MAX_LIMIT) {
    reasons.push("limit must be an integer between 1 and " + INVOICE_LIST_MAX_LIMIT);
  }

  return Object.freeze({
    covered: reasons.length === 0,
    index: index.name,
    reasons: Object.freeze(reasons),
  });
}

/** Trim and validate one optional string filter. */
function normalizeFilter(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvoiceIndexError(InvoiceIndexErrorCode.INVALID_FILTER, name + " must be a non-empty string", { name });
  }
  return value.trim();
}

/**
 * Build the index-aligned SQL for GET /invoices.
 *
 * The projection, filter order and ORDER BY are fixed by the covering indexes;
 * only the values and limit are parameterized. The selected index name is
 * returned alongside the query and optionally emitted to a metrics hook so a
 * regression to a non-covering path is observable.
 */
export function buildInvoiceListQuery(
  filters: InvoiceListFilters = {},
  options: InvoiceListQueryOptions = {},
): InvoiceListQuery {
  const normalized: InvoiceListFilterValues = {
    customerEmail: normalizeFilter(filters.customerEmail, "customerEmail"),
    status: normalizeFilter(filters.status, "status"),
  };

  const requestedLimit = filters.limit === undefined ? INVOICE_LIST_DEFAULT_LIMIT : filters.limit;
  if (typeof requestedLimit !== "number" || !Number.isFinite(requestedLimit) || requestedLimit < 1) {
    throw new InvoiceIndexError(InvoiceIndexErrorCode.INVALID_LIMIT, "limit must be a positive number", {
      limit: requestedLimit,
    });
  }
  const limit = Math.min(Math.floor(requestedLimit), INVOICE_LIST_MAX_LIMIT);

  const descriptor: InvoiceListQueryDescriptor = {
    filters: normalized,
    projection: INVOICE_LIST_PROJECTION,
    orderBy: INVOICE_LIST_ORDER_BY,
    limit,
  };
  const index = selectInvoiceListIndex(normalized);
  const coverage = checkInvoiceListCoverage(descriptor, index);
  if (!coverage.covered) {
    throw new InvoiceIndexError(InvoiceIndexErrorCode.NO_COVERING_INDEX, "Invoice list query is not covered", {
      index: index.name,
      reasons: coverage.reasons,
    });
  }

  const params: (string | number)[] = [];
  const conditions: string[] = [];
  if (normalized.customerEmail !== undefined) {
    conditions.push(INVOICE_LIST_FILTER_COLUMNS.customerEmail + " = $" + (params.length + 1));
    params.push(normalized.customerEmail);
  }
  if (normalized.status !== undefined) {
    conditions.push(INVOICE_LIST_FILTER_COLUMNS.status + " = $" + (params.length + 1));
    params.push(normalized.status);
  }
  const where = conditions.length === 0 ? "" : " WHERE " + conditions.join(" AND ");
  params.push(limit);

  const text =
    "SELECT " +
    INVOICE_LIST_PROJECTION.join(", ") +
    " FROM invoices" +
    where +
    " ORDER BY " +
    INVOICE_LIST_ORDER_BY[0]?.column +
    " " +
    INVOICE_LIST_ORDER_BY[0]?.direction +
    " LIMIT $" +
    params.length;

  if (options.onIndexSelected !== undefined) {
    options.onIndexSelected(
      Object.freeze({
        index: index.name,
        filterColumns: activeFilterColumns(normalized),
        projection: INVOICE_LIST_PROJECTION,
        limit,
      }),
    );
  }

  return Object.freeze({ text, params: Object.freeze(params), index: index.name });
}

/** Render an index definition as the exact Prisma declaration in schema.prisma. */
export function toPrismaIndexDeclaration(index: InvoiceCoveringIndex): string {
  const keys = index.keyColumns.map((column) =>
    column === INVOICE_LIST_COLUMNS.createdAt
      ? column + "(sort: " + (index.sortDirection === "DESC" ? "Desc" : "Asc") + ")"
      : column,
  );
  return '@@index([' + keys.join(", ") + '], name: "' + index.name + '")';
}

/** All three Prisma declarations, generated from the canonical definitions. */
export const INVOICE_LIST_INDEX_DECLARATIONS: readonly string[] = Object.freeze(
  INVOICE_LIST_INDEXES.map(toPrismaIndexDeclaration),
);
