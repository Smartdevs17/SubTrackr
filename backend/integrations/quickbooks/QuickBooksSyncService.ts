/**
 * QuickBooks Sync Service
 *
 * Handles two-way sync between SubTrackr and QuickBooks Online:
 *
 *   • Customers   — SubTrackr users ↔ QBO Customers
 *   • Invoices    — SubTrackr invoices → QBO Invoices
 *   • Payments    — SubTrackr payments → QBO Payments (applied to invoices)
 *   • Items       — SubTrackr subscription plans → QBO Items/Products
 *
 * All QBO API calls are authenticated with the access token obtained via
 * QuickBooksOAuthService. Errors are classified as retryable vs terminal.
 */

import type { QuickBooksOAuthService } from './QuickBooksOAuthService';

// ── QBO Entity Types ───────────────────────────────────────────────────────────

export interface QBOCustomer {
  Id?: string;
  SyncToken?: string;
  DisplayName: string;
  PrimaryEmailAddr?: { Address: string };
  PrimaryPhone?: { FreeFormNumber: string };
  BillAddr?: {
    Line1?: string;
    City?: string;
    CountrySubDivisionCode?: string;
    PostalCode?: string;
    Country?: string;
  };
  Notes?: string;
  Active?: boolean;
}

export interface QBOItem {
  Id?: string;
  SyncToken?: string;
  Name: string;
  Description?: string;
  Active?: boolean;
  Type: 'Service' | 'NonInventory' | 'Inventory';
  UnitPrice?: number;
  IncomeAccountRef?: { value: string; name?: string };
}

export interface QBOInvoice {
  Id?: string;
  SyncToken?: string;
  CustomerRef: { value: string; name?: string };
  Line: QBOInvoiceLine[];
  DueDate?: string; // YYYY-MM-DD
  DocNumber?: string;
  CustomerMemo?: { value: string };
  EmailStatus?: 'NotSet' | 'NeedToSend' | 'EmailSent';
  BillEmail?: { Address: string };
  TxnDate?: string; // YYYY-MM-DD
  PrivateNote?: string;
}

export interface QBOInvoiceLine {
  DetailType: 'SalesItemLineDetail';
  Amount: number;
  SalesItemLineDetail: {
    ItemRef: { value: string; name?: string };
    Qty?: number;
    UnitPrice?: number;
  };
  Description?: string;
}

export interface QBOPayment {
  Id?: string;
  SyncToken?: string;
  CustomerRef: { value: string; name?: string };
  TotalAmt: number;
  CurrencyRef?: { value: string };
  TxnDate?: string;
  PrivateNote?: string;
  LinkedTxn?: Array<{ TxnId: string; TxnType: 'Invoice' }>;
}

// ── SubTrackr Domain Types ─────────────────────────────────────────────────────

export interface SubTrackrCustomer {
  id: string;
  email: string;
  displayName: string;
  phone?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface SubTrackrInvoice {
  id: string;
  subscriptionId: string;
  subscriptionName: string;
  customerId: string;
  amount: number;
  currency: string;
  issuedAt: string; // ISO date string
  dueAt?: string;
  paidAt?: string;
  status: 'draft' | 'open' | 'paid' | 'void';
  description?: string;
  customerEmail?: string;
}

export interface SubTrackrPayment {
  id: string;
  invoiceId: string;
  customerId: string;
  amount: number;
  currency: string;
  paidAt: string;
}

export interface SubTrackrPlan {
  id: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  billingCycle: string;
}

// ── ID Map for cross-referencing ───────────────────────────────────────────────

export interface QBOIdMapping {
  subTrackrId: string;
  qboId: string;
  qboSyncToken: string;
  entityType: 'customer' | 'invoice' | 'payment' | 'item';
  lastSyncedAt: string;
}

export interface SyncResult {
  entity: string;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ id: string; error: string; retryable: boolean }>;
}

export interface FullSyncResult {
  customers: SyncResult;
  items: SyncResult;
  invoices: SyncResult;
  payments: SyncResult;
  syncedAt: string;
}

// ── Service ────────────────────────────────────────────────────────────────────

export class QuickBooksSyncService {
  private readonly oauthService: QuickBooksOAuthService;
  private readonly fetchImpl: typeof fetch;

  // Local ID mapping store — replace with DB persistence in production
  private readonly idMappings = new Map<string, QBOIdMapping>(); // `${entityType}:${subTrackrId}` → mapping

  // Default income account reference for service items in QBO
  private readonly defaultIncomeAccountRef = { value: '1', name: 'Services' };

  constructor(oauthService: QuickBooksOAuthService, fetchImpl: typeof fetch = fetch) {
    this.oauthService = oauthService;
    this.fetchImpl = fetchImpl;
  }

  // ── ID Mapping Helpers ─────────────────────────────────────────────────────

  storeMapping(mapping: QBOIdMapping): void {
    this.idMappings.set(`${mapping.entityType}:${mapping.subTrackrId}`, mapping);
  }

  getMapping(entityType: QBOIdMapping['entityType'], subTrackrId: string): QBOIdMapping | undefined {
    return this.idMappings.get(`${entityType}:${subTrackrId}`);
  }

  // ── Customer Sync ──────────────────────────────────────────────────────────

  async syncCustomer(merchantId: string, customer: SubTrackrCustomer): Promise<QBOIdMapping> {
    const existing = this.getMapping('customer', customer.id);
    const qboCustomer = this.mapCustomerToQBO(customer);

    if (existing) {
      const updated = await this.updateEntity(merchantId, 'customer', existing.qboId, existing.qboSyncToken, qboCustomer);
      const mapping: QBOIdMapping = {
        subTrackrId: customer.id,
        qboId: updated.Id ?? existing.qboId,
        qboSyncToken: updated.SyncToken ?? existing.qboSyncToken,
        entityType: 'customer',
        lastSyncedAt: new Date().toISOString(),
      };
      this.storeMapping(mapping);
      return mapping;
    }

    const created = await this.createEntity(merchantId, 'customer', qboCustomer);
    const mapping: QBOIdMapping = {
      subTrackrId: customer.id,
      qboId: created.Id ?? '',
      qboSyncToken: created.SyncToken ?? '0',
      entityType: 'customer',
      lastSyncedAt: new Date().toISOString(),
    };
    this.storeMapping(mapping);
    return mapping;
  }

  async syncCustomers(merchantId: string, customers: SubTrackrCustomer[]): Promise<SyncResult> {
    const result: SyncResult = { entity: 'customer', created: 0, updated: 0, skipped: 0, errors: [] };

    for (const customer of customers) {
      try {
        const existing = this.getMapping('customer', customer.id);
        await this.syncCustomer(merchantId, customer);
        if (existing) result.updated++;
        else result.created++;
      } catch (err) {
        result.errors.push({
          id: customer.id,
          error: err instanceof Error ? err.message : 'Unknown error',
          retryable: this.isRetryableError(err),
        });
      }
    }

    return result;
  }

  // ── Item (Plan) Sync ───────────────────────────────────────────────────────

  async syncPlan(merchantId: string, plan: SubTrackrPlan): Promise<QBOIdMapping> {
    const existing = this.getMapping('item', plan.id);
    const qboItem = this.mapPlanToQBOItem(plan);

    if (existing) {
      const updated = await this.updateEntity(merchantId, 'item', existing.qboId, existing.qboSyncToken, qboItem);
      const mapping: QBOIdMapping = {
        subTrackrId: plan.id,
        qboId: updated.Id ?? existing.qboId,
        qboSyncToken: updated.SyncToken ?? existing.qboSyncToken,
        entityType: 'item',
        lastSyncedAt: new Date().toISOString(),
      };
      this.storeMapping(mapping);
      return mapping;
    }

    const created = await this.createEntity(merchantId, 'item', qboItem);
    const mapping: QBOIdMapping = {
      subTrackrId: plan.id,
      qboId: created.Id ?? '',
      qboSyncToken: created.SyncToken ?? '0',
      entityType: 'item',
      lastSyncedAt: new Date().toISOString(),
    };
    this.storeMapping(mapping);
    return mapping;
  }

  // ── Invoice Sync ───────────────────────────────────────────────────────────

  async syncInvoice(merchantId: string, invoice: SubTrackrInvoice): Promise<QBOIdMapping> {
    const customerMapping = this.getMapping('customer', invoice.customerId);
    if (!customerMapping) {
      throw new Error(`Customer ${invoice.customerId} has not been synced to QuickBooks yet`);
    }

    const itemMapping = this.getMapping('item', invoice.subscriptionId);
    const itemRef = itemMapping
      ? { value: itemMapping.qboId, name: invoice.subscriptionName }
      : { value: '1', name: invoice.subscriptionName }; // fallback to default item

    const qboInvoice = this.mapInvoiceToQBO(invoice, customerMapping.qboId, itemRef);
    const existing = this.getMapping('invoice', invoice.id);

    if (existing) {
      // Don't update paid invoices in QBO to avoid voiding payments
      if (invoice.status === 'paid') {
        return existing;
      }
      const updated = await this.updateEntity(merchantId, 'invoice', existing.qboId, existing.qboSyncToken, qboInvoice);
      const mapping: QBOIdMapping = {
        subTrackrId: invoice.id,
        qboId: updated.Id ?? existing.qboId,
        qboSyncToken: updated.SyncToken ?? existing.qboSyncToken,
        entityType: 'invoice',
        lastSyncedAt: new Date().toISOString(),
      };
      this.storeMapping(mapping);
      return mapping;
    }

    const created = await this.createEntity(merchantId, 'invoice', qboInvoice);
    const mapping: QBOIdMapping = {
      subTrackrId: invoice.id,
      qboId: created.Id ?? '',
      qboSyncToken: created.SyncToken ?? '0',
      entityType: 'invoice',
      lastSyncedAt: new Date().toISOString(),
    };
    this.storeMapping(mapping);
    return mapping;
  }

  // ── Payment Sync ───────────────────────────────────────────────────────────

  async syncPayment(merchantId: string, payment: SubTrackrPayment): Promise<QBOIdMapping> {
    // Don't re-sync already recorded payments
    const existing = this.getMapping('payment', payment.id);
    if (existing) return existing;

    const customerMapping = this.getMapping('customer', payment.customerId);
    if (!customerMapping) {
      throw new Error(`Customer ${payment.customerId} has not been synced to QuickBooks yet`);
    }

    const invoiceMapping = this.getMapping('invoice', payment.invoiceId);
    const qboPayment = this.mapPaymentToQBO(payment, customerMapping.qboId, invoiceMapping?.qboId);

    const created = await this.createEntity(merchantId, 'payment', qboPayment);
    const mapping: QBOIdMapping = {
      subTrackrId: payment.id,
      qboId: created.Id ?? '',
      qboSyncToken: created.SyncToken ?? '0',
      entityType: 'payment',
      lastSyncedAt: new Date().toISOString(),
    };
    this.storeMapping(mapping);
    return mapping;
  }

  // ── Full Sync ──────────────────────────────────────────────────────────────

  async fullSync(
    merchantId: string,
    data: {
      customers: SubTrackrCustomer[];
      plans: SubTrackrPlan[];
      invoices: SubTrackrInvoice[];
      payments: SubTrackrPayment[];
    },
  ): Promise<FullSyncResult> {
    const customerResult = await this.syncCustomers(merchantId, data.customers);

    const itemResult: SyncResult = { entity: 'item', created: 0, updated: 0, skipped: 0, errors: [] };
    for (const plan of data.plans) {
      try {
        const existing = this.getMapping('item', plan.id);
        await this.syncPlan(merchantId, plan);
        if (existing) itemResult.updated++;
        else itemResult.created++;
      } catch (err) {
        itemResult.errors.push({
          id: plan.id,
          error: err instanceof Error ? err.message : 'Unknown error',
          retryable: this.isRetryableError(err),
        });
      }
    }

    const invoiceResult: SyncResult = { entity: 'invoice', created: 0, updated: 0, skipped: 0, errors: [] };
    for (const invoice of data.invoices) {
      try {
        const existing = this.getMapping('invoice', invoice.id);
        if (existing && invoice.status === 'paid') {
          invoiceResult.skipped++;
          continue;
        }
        await this.syncInvoice(merchantId, invoice);
        if (existing) invoiceResult.updated++;
        else invoiceResult.created++;
      } catch (err) {
        invoiceResult.errors.push({
          id: invoice.id,
          error: err instanceof Error ? err.message : 'Unknown error',
          retryable: this.isRetryableError(err),
        });
      }
    }

    const paymentResult: SyncResult = { entity: 'payment', created: 0, updated: 0, skipped: 0, errors: [] };
    for (const payment of data.payments) {
      try {
        const existing = this.getMapping('payment', payment.id);
        if (existing) {
          paymentResult.skipped++;
          continue;
        }
        await this.syncPayment(merchantId, payment);
        paymentResult.created++;
      } catch (err) {
        paymentResult.errors.push({
          id: payment.id,
          error: err instanceof Error ? err.message : 'Unknown error',
          retryable: this.isRetryableError(err),
        });
      }
    }

    return {
      customers: customerResult,
      items: itemResult,
      invoices: invoiceResult,
      payments: paymentResult,
      syncedAt: new Date().toISOString(),
    };
  }

  // ── QBO API Calls ──────────────────────────────────────────────────────────

  private async createEntity(
    merchantId: string,
    entityType: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, string>> {
    const { accessToken, realmId } = await this.getAuthContext(merchantId);
    const baseUrl = this.oauthService.getBaseUrl();
    const entityName = this.qboEntityName(entityType);
    const url = `${baseUrl}/v3/company/${realmId}/${entityName}?minorversion=65`;

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.buildHeaders(accessToken),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`QBO create ${entityType} failed: ${response.status} ${text}`);
    }

    const data = await response.json() as Record<string, Record<string, string>>;
    return data[entityName] ?? data;
  }

  private async updateEntity(
    merchantId: string,
    entityType: string,
    qboId: string,
    syncToken: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, string>> {
    const { accessToken, realmId } = await this.getAuthContext(merchantId);
    const baseUrl = this.oauthService.getBaseUrl();
    const entityName = this.qboEntityName(entityType);
    const url = `${baseUrl}/v3/company/${realmId}/${entityName}?minorversion=65`;

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.buildHeaders(accessToken),
      body: JSON.stringify({ ...body, Id: qboId, SyncToken: syncToken, sparse: true }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`QBO update ${entityType} failed: ${response.status} ${text}`);
    }

    const data = await response.json() as Record<string, Record<string, string>>;
    return data[entityName] ?? data;
  }

  // ── Data Mapping ───────────────────────────────────────────────────────────

  private mapCustomerToQBO(c: SubTrackrCustomer): QBOCustomer {
    const customer: QBOCustomer = {
      DisplayName: c.displayName,
      Active: true,
    };
    if (c.email) customer.PrimaryEmailAddr = { Address: c.email };
    if (c.phone) customer.PrimaryPhone = { FreeFormNumber: c.phone };
    if (c.addressLine1 || c.city) {
      customer.BillAddr = {
        Line1: c.addressLine1,
        City: c.city,
        CountrySubDivisionCode: c.state,
        PostalCode: c.postalCode,
        Country: c.country,
      };
    }
    return customer;
  }

  private mapPlanToQBOItem(plan: SubTrackrPlan): QBOItem {
    return {
      Name: `${plan.name} (${plan.billingCycle})`,
      Description: plan.description ?? `${plan.name} subscription — ${plan.billingCycle}`,
      Type: 'Service',
      UnitPrice: plan.price,
      Active: true,
      IncomeAccountRef: this.defaultIncomeAccountRef,
    };
  }

  private mapInvoiceToQBO(
    invoice: SubTrackrInvoice,
    qboCustomerId: string,
    itemRef: { value: string; name?: string },
  ): QBOInvoice {
    const txnDate = invoice.issuedAt.slice(0, 10);
    const dueDate = invoice.dueAt?.slice(0, 10);

    const qboInvoice: QBOInvoice = {
      CustomerRef: { value: qboCustomerId },
      TxnDate: txnDate,
      DocNumber: invoice.id.slice(-8).toUpperCase(),
      PrivateNote: `SubTrackr invoice ${invoice.id} for subscription ${invoice.subscriptionId}`,
      Line: [
        {
          DetailType: 'SalesItemLineDetail',
          Amount: invoice.amount,
          Description: invoice.description ?? invoice.subscriptionName,
          SalesItemLineDetail: {
            ItemRef: itemRef,
            Qty: 1,
            UnitPrice: invoice.amount,
          },
        },
      ],
    };

    if (dueDate) qboInvoice.DueDate = dueDate;
    if (invoice.customerEmail) {
      qboInvoice.BillEmail = { Address: invoice.customerEmail };
      qboInvoice.EmailStatus = 'NeedToSend';
    }

    return qboInvoice;
  }

  private mapPaymentToQBO(
    payment: SubTrackrPayment,
    qboCustomerId: string,
    qboInvoiceId?: string,
  ): QBOPayment {
    const qboPayment: QBOPayment = {
      CustomerRef: { value: qboCustomerId },
      TotalAmt: payment.amount,
      TxnDate: payment.paidAt.slice(0, 10),
      CurrencyRef: { value: payment.currency.toUpperCase() },
      PrivateNote: `SubTrackr payment ${payment.id}`,
    };

    if (qboInvoiceId) {
      qboPayment.LinkedTxn = [{ TxnId: qboInvoiceId, TxnType: 'Invoice' }];
    }

    return qboPayment;
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  private async getAuthContext(merchantId: string): Promise<{ accessToken: string; realmId: string }> {
    const accessToken = await this.oauthService.getValidAccessToken(merchantId);
    const tokenSet = this.oauthService.getTokenSet(merchantId);
    if (!tokenSet) throw new Error('No token set found');
    return { accessToken, realmId: tokenSet.realmId };
  }

  private buildHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private qboEntityName(entityType: string): string {
    const map: Record<string, string> = {
      customer: 'Customer',
      invoice: 'Invoice',
      payment: 'Payment',
      item: 'Item',
    };
    return map[entityType] ?? entityType;
  }

  private isRetryableError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const msg = err.message.toLowerCase();
    return msg.includes('429') || msg.includes('503') || msg.includes('timeout') || msg.includes('network');
  }
}
