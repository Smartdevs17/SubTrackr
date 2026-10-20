/**
 * FreshBooks Sync Service
 *
 * Two-way sync between SubTrackr and FreshBooks Accounting:
 *
 *   • Clients    — SubTrackr users     ↔ FreshBooks Clients
 *   • Invoices   — SubTrackr invoices  → FreshBooks Invoices
 *   • Payments   — SubTrackr payments  → FreshBooks Payments (applied to invoices)
 *   • Expenses   — SubTrackr costs     → FreshBooks Expenses
 *   • Estimates  — SubTrackr quotes    → FreshBooks Estimates
 *
 * Every FreshBooks call is authenticated with the access token minted by
 * {@link FreshBooksOAuthService} and scoped to the merchant's `accountId`.
 * Errors are classified as retryable (429 / 5xx / transport) versus terminal so
 * the caller can decide whether to re-queue a failed record.
 *
 * Accounting is a ledger, not a document store: a *paid* FreshBooks invoice and
 * an *already recorded* payment must never be rewritten, so both are reported
 * as `skipped` once a local mapping exists.
 */

import type { FreshBooksOAuthService } from './FreshBooksOAuthService';

// ── SubTrackr domain types ─────────────────────────────────────────────────────

export interface SubTrackrClient {
  id: string;
  email: string;
  displayName: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  currency?: string;
}

export interface SubTrackrInvoice {
  id: string;
  subscriptionId: string;
  subscriptionName: string;
  clientId: string;
  amount: number;
  currency: string;
  issuedAt: string; // ISO timestamp
  dueAt?: string;
  paidAt?: string;
  status: 'draft' | 'open' | 'paid' | 'void';
  description?: string;
  clientEmail?: string;
  /** FreshBooks tax names to apply to the invoice line, e.g. `['VAT', 'GST']`. */
  taxNames?: string[];
}

export interface SubTrackrPayment {
  id: string;
  invoiceId: string;
  clientId: string;
  amount: number;
  currency: string;
  paidAt: string;
  paymentType?: 'check' | 'cash' | 'creditcard' | 'ach' | 'other';
  reference?: string;
}

export interface SubTrackrExpense {
  id: string;
  vendor: string;
  category: string;
  amount: number;
  currency: string;
  incurredAt: string;
  notes?: string;
  /** Set when the expense belongs to a SubTrackr client (reimbursable). */
  clientId?: string;
}

export interface SubTrackrEstimate {
  id: string;
  clientId: string;
  lineItems: Array<{ description: string; amount: number }>;
  expiresAt?: string;
  status: 'draft' | 'sent' | 'declined' | 'accepted';
}

// ── FreshBooks API types (subset) ──────────────────────────────────────────────

export interface FreshBooksClient {
  clientid?: string;
  userid?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  currency_code?: string;
  visiblename?: string;
  updated?: string;
}

export interface FreshBooksInvoiceLine {
  description: string;
  amount: number;
  qty?: number;
  unit_cost?: number;
  tax_names?: string[];
}

export interface FreshBooksInvoice {
  invoiceid?: string;
  clientid?: string;
  invoice_number?: string;
  date?: string;
  due_date?: string;
  status?: 'draft' | 'sent' | 'viewed' | 'paid' | 'deleted';
  amount?: { amount: number; currency_code?: string };
  lines?: FreshBooksInvoiceLine[];
  currency_code?: string;
  client_email?: string;
  notes?: string;
  updated?: string;
}

export interface FreshBooksPayment {
  paymentid?: string;
  clientid?: string;
  amount?: { amount: number; currency_code?: string };
  date: string;
  payment_type: 'check' | 'cash' | 'creditcard' | 'ach' | 'other';
  payment_account?: number;
  invoice_payment?: { invoiceid: string };
  reference?: string;
  currency_code?: string;
}

export interface FreshBooksExpense {
  expenseid?: string;
  vendor?: string;
  category?: string;
  date: string;
  amount?: { amount: number; currency_code?: string };
  notes?: string;
  currency_code?: string;
  clientid?: string;
  billable?: boolean;
}

export interface FreshBooksEstimate {
  estimateid?: string;
  clientid: string;
  expiry_date?: string;
  status?: 'draft' | 'sent' | 'declined' | 'accepted' | 'invoiced' | 'rejected';
  lines: FreshBooksInvoiceLine[];
  updated?: string;
}

// ── ID mapping ─────────────────────────────────────────────────────────────────

export type FreshBooksEntityType = 'client' | 'invoice' | 'payment' | 'expense' | 'estimate';
export type SyncOutcome = 'created' | 'updated' | 'skipped';

export interface FreshBooksIdMapping {
  subTrackrId: string;
  freshBooksId: string;
  entityType: FreshBooksEntityType;
  /** FreshBooks `updated` timestamp, kept for last-write-wins conflict logs. */
  freshBooksUpdatedAt?: string;
  lastSyncedAt: string;
}

export interface FreshBooksSyncResult {
  entity: FreshBooksEntityType;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ id: string; error: string; retryable: boolean }>;
}

export interface FreshBooksFullSyncResult {
  clients: FreshBooksSyncResult;
  invoices: FreshBooksSyncResult;
  payments: FreshBooksSyncResult;
  expenses: FreshBooksSyncResult;
  syncedAt: string;
}

export interface DetailedSync {
  mapping: FreshBooksIdMapping;
  outcome: SyncOutcome;
}

// ── Service ────────────────────────────────────────────────────────────────────

type FreshBooksCall<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly retryable: boolean };

export interface FreshBooksSyncOptions {
  oauthService: FreshBooksOAuthService;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Payment account applied to payment records that do not name one. */
  defaultPaymentAccount?: number;
  /** Expense category applied to records whose category is blank. */
  defaultExpenseCategory?: string;
}

export class FreshBooksSyncService {
  private readonly oauthService: FreshBooksOAuthService;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly defaultPaymentAccount: number;
  private readonly defaultExpenseCategory: string;

  // Local ID mapping store — replace with DB persistence in production.
  private readonly idMappings = new Map<string, FreshBooksIdMapping>();

  constructor(options: FreshBooksSyncOptions) {
    this.oauthService = options.oauthService;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? 'https://api.freshbooks.com').replace(/\/+$/, '');
    this.defaultPaymentAccount = options.defaultPaymentAccount ?? 1;
    this.defaultExpenseCategory = options.defaultExpenseCategory ?? 'Other';
  }

  // ── ID mapping helpers ────────────────────────────────────────────────────

  storeMapping(mapping: FreshBooksIdMapping): void {
    this.idMappings.set(this.mappingKey(mapping.entityType, mapping.subTrackrId), mapping);
  }

  getMapping(
    entityType: FreshBooksEntityType,
    subTrackrId: string,
  ): FreshBooksIdMapping | undefined {
    return this.idMappings.get(this.mappingKey(entityType, subTrackrId));
  }

  // ── Client sync ───────────────────────────────────────────────────────────

  async syncClient(merchantId: string, client: SubTrackrClient): Promise<FreshBooksIdMapping> {
    return (await this.syncClientDetailed(merchantId, client)).mapping;
  }

  async syncClients(merchantId: string, clients: SubTrackrClient[]): Promise<FreshBooksSyncResult> {
    return this.runBatch('client', clients, (client) => this.syncClientDetailed(merchantId, client));
  }

  private async syncClientDetailed(
    merchantId: string,
    client: SubTrackrClient,
  ): Promise<DetailedSync> {
    const existing = this.getMapping('client', client.id);
    const call = await this.call<FreshBooksClient>(
      merchantId,
      existing ? 'PUT' : 'POST',
      'clients',
      this.mapClientToFreshBooks(client),
      existing ? { clientid: Number(existing.freshBooksId) } : undefined,
    );
    if (!call.ok) throw new Error(`${call.code}: ${call.message}`);

    return this.complete('client', client.id, existing, call.data.clientid, call.data.updated);
  }

  // ── Invoice sync ──────────────────────────────────────────────────────────

  async syncInvoice(merchantId: string, invoice: SubTrackrInvoice): Promise<FreshBooksIdMapping> {
    return (await this.syncInvoiceDetailed(merchantId, invoice)).mapping;
  }

  async syncInvoices(merchantId: string, invoices: SubTrackrInvoice[]): Promise<FreshBooksSyncResult> {
    return this.runBatch('invoice', invoices, (invoice) =>
      this.syncInvoiceDetailed(merchantId, invoice),
    );
  }

  private async syncInvoiceDetailed(
    merchantId: string,
    invoice: SubTrackrInvoice,
  ): Promise<DetailedSync> {
    const existing = this.getMapping('invoice', invoice.id);
    // A paid FreshBooks invoice is a closed accounting entry: rewriting it would
    // desynchronise the payment already recorded against it.
    if (existing && invoice.status === 'paid') {
      return { mapping: existing, outcome: 'skipped' };
    }

    const clientMapping = this.getMapping('client', invoice.clientId);
    if (!clientMapping) {
      throw new Error(`Client ${invoice.clientId} has not been synced to FreshBooks yet`);
    }

    const call = await this.call<FreshBooksInvoice>(
      merchantId,
      existing ? 'PUT' : 'POST',
      'invoices',
      this.mapInvoiceToFreshBooks(invoice, clientMapping.freshBooksId),
      existing ? { invoiceid: Number(existing.freshBooksId) } : undefined,
    );
    if (!call.ok) throw new Error(`${call.code}: ${call.message}`);

    return this.complete('invoice', invoice.id, existing, call.data.invoiceid, call.data.updated);
  }

  // ── Payment sync ──────────────────────────────────────────────────────────

  async syncPayment(
    merchantId: string,
    payment: SubTrackrPayment,
  ): Promise<FreshBooksIdMapping> {
    return (await this.syncPaymentDetailed(merchantId, payment)).mapping;
  }

  async syncPayments(merchantId: string, payments: SubTrackrPayment[]): Promise<FreshBooksSyncResult> {
    return this.runBatch('payment', payments, (payment) =>
      this.syncPaymentDetailed(merchantId, payment),
    );
  }

  private async syncPaymentDetailed(
    merchantId: string,
    payment: SubTrackrPayment,
  ): Promise<DetailedSync> {
    // A recorded payment is immutable — never double-post it.
    const existing = this.getMapping('payment', payment.id);
    if (existing) return { mapping: existing, outcome: 'skipped' };

    const clientMapping = this.getMapping('client', payment.clientId);
    if (!clientMapping) {
      throw new Error(`Client ${payment.clientId} has not been synced to FreshBooks yet`);
    }
    const invoiceMapping = this.getMapping('invoice', payment.invoiceId);
    if (!invoiceMapping) {
      throw new Error(`Invoice ${payment.invoiceId} has not been synced to FreshBooks yet`);
    }

    const body = this.mapPaymentToFreshBooks(
      payment,
      clientMapping.freshBooksId,
      invoiceMapping.freshBooksId,
    );
    const call = await this.call<FreshBooksPayment>(merchantId, 'POST', 'payments', body);
    if (!call.ok) throw new Error(`${call.code}: ${call.message}`);

    return this.complete('payment', payment.id, undefined, call.data.paymentid, call.data.updated);
  }

  // ── Expense sync ──────────────────────────────────────────────────────────

  async syncExpense(
    merchantId: string,
    expense: SubTrackrExpense,
  ): Promise<FreshBooksIdMapping> {
    return (await this.syncExpenseDetailed(merchantId, expense)).mapping;
  }

  async syncExpenses(merchantId: string, expenses: SubTrackrExpense[]): Promise<FreshBooksSyncResult> {
    return this.runBatch('expense', expenses, (expense) =>
      this.syncExpenseDetailed(merchantId, expense),
    );
  }

  private async syncExpenseDetailed(
    merchantId: string,
    expense: SubTrackrExpense,
  ): Promise<DetailedSync> {
    const existing = this.getMapping('expense', expense.id);
    const call = await this.call<FreshBooksExpense>(
      merchantId,
      existing ? 'PUT' : 'POST',
      'expenses/expenses',
      this.mapExpenseToFreshBooks(expense),
      existing ? { expenseid: Number(existing.freshBooksId) } : undefined,
    );
    if (!call.ok) throw new Error(`${call.code}: ${call.message}`);

    return this.complete('expense', expense.id, existing, call.data.expenseid, call.data.updated);
  }

  // ── Estimate sync ─────────────────────────────────────────────────────────

  async syncEstimate(
    merchantId: string,
    estimate: SubTrackrEstimate,
  ): Promise<FreshBooksIdMapping> {
    return (await this.syncEstimateDetailed(merchantId, estimate)).mapping;
  }

  async syncEstimates(merchantId: string, estimates: SubTrackrEstimate[]): Promise<FreshBooksSyncResult> {
    return this.runBatch('estimate', estimates, (estimate) =>
      this.syncEstimateDetailed(merchantId, estimate),
    );
  }

  private async syncEstimateDetailed(
    merchantId: string,
    estimate: SubTrackrEstimate,
  ): Promise<DetailedSync> {
    const existing = this.getMapping('estimate', estimate.id);
    if (existing && (estimate.status === 'accepted' || estimate.status === 'declined')) {
      return { mapping: existing, outcome: 'skipped' };
    }

    const clientMapping = this.getMapping('client', estimate.clientId);
    if (!clientMapping) {
      throw new Error(`Client ${estimate.clientId} has not been synced to FreshBooks yet`);
    }

    const body: FreshBooksEstimate = {
      clientid: clientMapping.freshBooksId,
      lines: estimate.lineItems.map((line) => ({
        description: line.description,
        amount: line.amount,
        qty: 1,
        unit_cost: line.amount,
      })),
    };
    if (estimate.expiresAt) body.expiry_date = this.toFreshBooksDate(estimate.expiresAt);
    if (estimate.status !== 'draft') body.status = estimate.status;

    const call = await this.call<FreshBooksEstimate>(
      merchantId,
      existing ? 'PUT' : 'POST',
      'estimates/estimates',
      body as unknown as Record<string, unknown>,
      existing ? { estimateid: Number(existing.freshBooksId) } : undefined,
    );
    if (!call.ok) throw new Error(`${call.code}: ${call.message}`);

    return this.complete('estimate', estimate.id, existing, call.data.estimateid, call.data.updated);
  }

  // ── Full sync ─────────────────────────────────────────────────────────────

  /**
   * Sync every entity type in dependency order: clients first, then invoices
   * (which reference a client), then payments (which reference an invoice), and
   * finally the independent expense and estimate records.
   */
  async fullSync(
    merchantId: string,
    data: {
      clients: SubTrackrClient[];
      invoices: SubTrackrInvoice[];
      payments: SubTrackrPayment[];
      expenses?: SubTrackrExpense[];
      estimates?: SubTrackrEstimate[];
    },
  ): Promise<FreshBooksFullSyncResult> {
    const clients = await this.syncClients(merchantId, data.clients);
    const invoices = await this.syncInvoices(merchantId, data.invoices);
    const payments = await this.syncPayments(merchantId, data.payments);
    const expenses = await this.syncExpenses(merchantId, data.expenses ?? []);
    await this.syncEstimates(merchantId, data.estimates ?? []);

    return { clients, invoices, payments, expenses, syncedAt: new Date().toISOString() };
  }

  // ── Data mapping ──────────────────────────────────────────────────────────

  private mapClientToFreshBooks(client: SubTrackrClient): Record<string, unknown> {
    const parts = client.displayName.trim().split(/\s+/).filter(Boolean);
    const firstName = parts.shift() ?? client.displayName;

    const body: Record<string, unknown> = {
      email: client.email,
      first_name: firstName,
      last_name: parts.join(' '),
      visiblename: client.displayName,
    };

    if (client.phone) body.phone = client.phone;
    if (client.currency) body.currency_code = client.currency.toUpperCase();
    if (client.addressLine1 || client.city || client.country) {
      body.address = {
        line1: client.addressLine1,
        line2: client.addressLine2,
        city: client.city,
        state: client.state,
        zip: client.postalCode,
        country: client.country,
      };
    }

    return body;
  }

  private mapInvoiceToFreshBooks(
    invoice: SubTrackrInvoice,
    freshBooksClientId: string,
  ): Record<string, unknown> {
    const taxNames = invoice.taxNames?.length ? invoice.taxNames : undefined;

    const line: FreshBooksInvoiceLine = {
      description: invoice.description ?? invoice.subscriptionName,
      amount: invoice.amount,
      qty: 1,
      unit_cost: invoice.amount,
    };
    if (taxNames) line.tax_names = taxNames;

    const body: Record<string, unknown> = {
      clientid: freshBooksClientId,
      invoice_number: invoice.id.slice(-8).toUpperCase(),
      date: this.toFreshBooksDate(invoice.issuedAt),
      due_date: this.toFreshBooksDate(invoice.dueAt ?? invoice.issuedAt),
      status:
        invoice.status === 'paid' ? 'paid' : invoice.status === 'void' ? 'deleted' : 'sent',
      currency_code: invoice.currency.toUpperCase(),
      lines: [line],
      notes: `SubTrackr invoice ${invoice.id} for subscription ${invoice.subscriptionId}`,
    };

    if (invoice.clientEmail) body.client_email = invoice.clientEmail;

    return body;
  }

  private mapPaymentToFreshBooks(
    payment: SubTrackrPayment,
    freshBooksClientId: string,
    freshBooksInvoiceId: string,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      clientid: freshBooksClientId,
      amount: { amount: payment.amount, currency_code: payment.currency.toUpperCase() },
      date: this.toFreshBooksDate(payment.paidAt),
      payment_type: payment.paymentType ?? 'other',
      payment_account: this.defaultPaymentAccount,
      invoice_payment: { invoiceid: freshBooksInvoiceId },
    };

    if (payment.reference) body.reference = payment.reference;
    return body;
  }

  private mapExpenseToFreshBooks(expense: SubTrackrExpense): Record<string, unknown> {
    const body: Record<string, unknown> = {
      vendor: expense.vendor,
      category: expense.category || this.defaultExpenseCategory,
      date: this.toFreshBooksDate(expense.incurredAt),
      amount: { amount: expense.amount, currency_code: expense.currency.toUpperCase() },
      currency_code: expense.currency.toUpperCase(),
      billable: Boolean(expense.clientId),
    };

    if (expense.notes) body.notes = expense.notes;
    if (expense.clientId) {
      const clientMapping = this.getMapping('client', expense.clientId);
      if (!clientMapping) {
        throw new Error(`Client ${expense.clientId} has not been synced to FreshBooks yet`);
      }
      body.clientid = clientMapping.freshBooksId;
    }

    return body;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private mappingKey(entityType: FreshBooksEntityType, subTrackrId: string): string {
    return `${entityType}:${subTrackrId}`;
  }

  /** Persist the returned FreshBooks id and report created / updated. */
  private complete(
    entityType: FreshBooksEntityType,
    subTrackrId: string,
    existing: FreshBooksIdMapping | undefined,
    freshBooksId: string | undefined,
    freshBooksUpdatedAt?: string,
  ): DetailedSync {
    if (!freshBooksId) {
      throw new Error(`FreshBooks ${entityType} response contained no id`);
    }
    const mapping: FreshBooksIdMapping = {
      subTrackrId,
      freshBooksId,
      entityType,
      freshBooksUpdatedAt,
      lastSyncedAt: new Date().toISOString(),
    };
    this.storeMapping(mapping);
    return { mapping, outcome: existing ? 'updated' : 'created' };
  }

  private async runBatch<T extends { id: string }>(
    entityType: FreshBooksEntityType,
    records: T[],
    syncOne: (record: T) => Promise<DetailedSync>,
  ): Promise<FreshBooksSyncResult> {
    const result: FreshBooksSyncResult = {
      entity: entityType,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    for (const record of records) {
      try {
        const { outcome } = await syncOne(record);
        result[outcome] += 1;
      } catch (error) {
        result.errors.push({
          id: record.id,
          error: error instanceof Error ? error.message : 'Unknown error',
          retryable: this.isRetryableError(error),
        });
      }
    }

    return result;
  }

  private async call<T>(
    merchantId: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
    resourceId?: Record<string, string | number>,
  ): Promise<FreshBooksCall<T>> {
    let accessToken: string;
    try {
      accessToken = await this.oauthService.getValidAccessToken(merchantId);
    } catch (error) {
      return {
        ok: false,
        code: 'freshbooks_unauthorized',
        message: error instanceof Error ? error.message : 'No valid FreshBooks access token',
        retryable: false,
      };
    }

    const accountId = this.oauthService.getTokenSet(merchantId)?.accountId;
    if (!accountId) {
      return {
        ok: false,
        code: 'freshbooks_missing_account',
        message: 'No FreshBooks account id is bound to this connection',
        retryable: false,
      };
    }

    const resourcePath = resourceId
      ? Object.keys(resourceId)
          .map((key) => `${key}/${resourceId[key]}`)
          .join('/')
      : '';
    const url = `${this.baseUrl}/accounting/${accountId}/api/${path}${
      resourcePath ? `/${resourcePath}` : ''
    }`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      return {
        ok: false,
        code: 'freshbooks_transport_error',
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      };
    }

    const text = await response.text();
    if (response.status === 429 || response.status >= 500) {
      return {
        ok: false,
        code: `freshbooks_http_${response.status}`,
        message: text.slice(0, 300) || `FreshBooks returned HTTP ${response.status}`,
        retryable: true,
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        code: `freshbooks_http_${response.status}`,
        message: text.slice(0, 300) || `FreshBooks returned HTTP ${response.status}`,
        retryable: false,
      };
    }
    // Some FreshBooks mutations answer 200 with an empty body.
    if (!text) return { ok: true, data: {} as T };

    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const envelope = parsed.response as { result?: T } | undefined;
      return { ok: true, data: envelope?.result ?? (parsed as T) };
    } catch {
      return {
        ok: false,
        code: 'freshbooks_invalid_json',
        message: 'FreshBooks returned a body that is not JSON',
        retryable: false,
      };
    }
  }

  /** FreshBooks expects `YYYY-MM-DD`. */
  private toFreshBooksDate(iso: string): string {
    return iso.slice(0, 10);
  }

  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return (
      message.includes('429') ||
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('transport_error') ||
      message.includes('http_5')
    );
  }
}
