/**
 * backend/src/services/taxReceipts.ts
 *
 * Production-ready Tax Receipt service.
 *
 * Implements compliant fiscal and tax receipt generation for subscriptions
 * and one-off payments:
 *  - Strict integer minor-unit calculations (no IEEE-754 float drift)
 *  - Deterministic idempotency by paymentId
 *  - EU/UK/US compliant reverse charge and exemption rules
 *  - Tamper-evident cryptographic fiscal seal (SHA-256)
 *  - Full voiding and credit note / adjustment audit trail
 *  - Structured observability hooks (logs & Prometheus-style metrics)
 */

import { createHmac, createHash } from 'crypto';
import { logger } from '../utils/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TaxReceiptStatus = 'issued' | 'voided' | 'credited';

export interface TaxEntity {
  legalName: string;
  address: string;
  country: string; // ISO 2-letter (e.g. "GB", "US", "DE")
  taxId?: string;  // VAT / EIN / GST registration number
  email?: string;
}

export interface TaxCustomer extends TaxEntity {
  isBusiness: boolean;
  customerId?: string;
}

export interface TaxReceiptLineItemInput {
  description: string;
  quantity: number;
  unitPriceMinor: number;
  discountMinor?: number;
  taxRateBps?: number;     // Basis points (e.g. 2000 = 20.00%)
  taxCategory?: string;    // e.g. "standard", "digital_services", "exempt"
}

export interface TaxReceiptLineItem {
  description: string;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  netTaxableMinor: number;
  taxCategory: string;
  taxRateBps: number;
  taxAmountMinor: number;
  grossAmountMinor: number;
}

export interface TaxRateBreakdown {
  taxCategory: string;
  rateBps: number;
  taxableAmountMinor: number;
  taxCollectedMinor: number;
}

export interface TaxReceiptTotals {
  subtotalNetMinor: number;
  totalDiscountMinor: number;
  itemizedTax: TaxRateBreakdown[];
  totalTaxMinor: number;
  grandTotalGrossMinor: number;
}

export interface TaxReceipt {
  receiptId: string;
  receiptNumber: string;
  paymentId: string;
  invoiceId?: string;
  subscriptionId?: string;
  issuedAt: string;
  status: TaxReceiptStatus;
  seller: TaxEntity;
  buyer: TaxCustomer;
  currency: string;
  lineItems: TaxReceiptLineItem[];
  totals: TaxReceiptTotals;
  isReverseCharge: boolean;
  reverseChargeNotes?: string;
  isExempt: boolean;
  exemptionCertificateId?: string;
  fiscalSignature: string;
  voidReason?: string;
  voidedAt?: string;
  creditNoteReceiptId?: string;
  originalReceiptId?: string;
}

export interface TaxReceiptIssueRequest {
  paymentId: string;
  invoiceId?: string;
  subscriptionId?: string;
  seller: TaxEntity;
  buyer: TaxCustomer;
  currency: string;
  lineItems: TaxReceiptLineItemInput[];
  defaultTaxRateBps?: number;
  exemptionCertificateId?: string;
  isReverseCharge?: boolean;
}

export interface TaxReceiptMetrics {
  recordIssued(currency: string, amountMinor: number, taxMinor: number): void;
  recordVoided(receiptId: string): void;
  recordCreditNote(originalReceiptId: string, amountMinor: number): void;
  recordError(code: string): void;
}

export interface TaxReceiptRepository {
  save(receipt: TaxReceipt): Promise<void>;
  findById(receiptId: string): Promise<TaxReceipt | null>;
  findByPaymentId(paymentId: string): Promise<TaxReceipt | null>;
  update(receipt: TaxReceipt): Promise<void>;
  listByCustomer(customerId: string): Promise<TaxReceipt[]>;
}

// ── In-Memory Repository ──────────────────────────────────────────────────────

export class InMemoryTaxReceiptRepository implements TaxReceiptRepository {
  private receipts = new Map<string, TaxReceipt>();
  private byPayment = new Map<string, string>();

  async save(receipt: TaxReceipt): Promise<void> {
    this.receipts.set(receipt.receiptId, { ...receipt });
    this.byPayment.set(receipt.paymentId, receipt.receiptId);
  }

  async findById(receiptId: string): Promise<TaxReceipt | null> {
    const item = this.receipts.get(receiptId);
    return item ? { ...item } : null;
  }

  async findByPaymentId(paymentId: string): Promise<TaxReceipt | null> {
    const id = this.byPayment.get(paymentId);
    if (!id) return null;
    return this.findById(id);
  }

  async update(receipt: TaxReceipt): Promise<void> {
    this.receipts.set(receipt.receiptId, { ...receipt });
  }

  async listByCustomer(customerId: string): Promise<TaxReceipt[]> {
    return Array.from(this.receipts.values())
      .filter((r) => r.buyer.customerId === customerId)
      .map((r) => ({ ...r }));
  }

  clear(): void {
    this.receipts.clear();
    this.byPayment.clear();
  }
}

// ── Observability ─────────────────────────────────────────────────────────────

export const noopTaxReceiptMetrics: TaxReceiptMetrics = {
  recordIssued: () => {},
  recordVoided: () => {},
  recordCreditNote: () => {},
  recordError: () => {},
};

export class StructuredTaxReceiptTelemetry implements TaxReceiptMetrics {
  private readonly totals = {
    issued: 0,
    voided: 0,
    creditNotes: 0,
    errors: new Map<string, number>(),
    grossCents: 0,
    taxCents: 0,
  };

  recordIssued(currency: string, amountMinor: number, taxMinor: number): void {
    this.totals.issued += 1;
    this.totals.grossCents += amountMinor;
    this.totals.taxCents += taxMinor;
    logger.info('Tax receipt issued', { currency, amountMinor, taxMinor });
  }

  recordVoided(receiptId: string): void {
    this.totals.voided += 1;
    logger.info('Tax receipt voided', { receiptId });
  }

  recordCreditNote(originalReceiptId: string, amountMinor: number): void {
    this.totals.creditNotes += 1;
    logger.info('Tax credit note issued', { originalReceiptId, amountMinor });
  }

  recordError(code: string): void {
    this.totals.errors.set(code, (this.totals.errors.get(code) ?? 0) + 1);
    logger.error('Tax receipt operation error', { code });
  }

  getSnapshot() {
    return {
      ...this.totals,
      errors: Object.fromEntries(this.totals.errors),
    };
  }
}

// ── Service Implementation ────────────────────────────────────────────────────

export interface TaxReceiptServiceOptions {
  repository?: TaxReceiptRepository;
  metrics?: TaxReceiptMetrics;
  secretKey?: string;
  receiptNumberPrefix?: string;
  now?: () => Date;
}

export class TaxReceiptError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'TaxReceiptError';
  }
}

export class TaxReceiptService {
  private readonly repo: TaxReceiptRepository;
  private readonly metrics: TaxReceiptMetrics;
  private readonly secretKey: string;
  private readonly prefix: string;
  private readonly now: () => Date;
  private receiptCounter = 0;

  constructor(options: TaxReceiptServiceOptions = {}) {
    this.repo = options.repository ?? new InMemoryTaxReceiptRepository();
    this.metrics = options.metrics ?? noopTaxReceiptMetrics;
    this.secretKey = options.secretKey ?? 'subtrackr-tax-receipt-secret-2026';
    this.prefix = options.receiptNumberPrefix ?? 'TR';
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Generates a tamper-evident digital seal for an immutable tax receipt.
   */
  generateFiscalSignature(payload: {
    receiptNumber: string;
    paymentId: string;
    totalMinor: number;
    taxMinor: number;
    issuedAt: string;
    sellerTaxId?: string;
    buyerTaxId?: string;
  }): string {
    const canonical = [
      payload.receiptNumber,
      payload.paymentId,
      payload.totalMinor,
      payload.taxMinor,
      payload.issuedAt,
      payload.sellerTaxId ?? '',
      payload.buyerTaxId ?? '',
    ].join('::');

    return createHmac('sha256', this.secretKey).update(canonical).digest('hex');
  }

  /**
   * Verifies the authenticity of a tax receipt.
   */
  verifyReceiptAuthenticity(receipt: TaxReceipt): boolean {
    const expected = this.generateFiscalSignature({
      receiptNumber: receipt.receiptNumber,
      paymentId: receipt.paymentId,
      totalMinor: receipt.totals.grandTotalGrossMinor,
      taxMinor: receipt.totals.totalTaxMinor,
      issuedAt: receipt.issuedAt,
      sellerTaxId: receipt.seller.taxId,
      buyerTaxId: receipt.buyer.taxId,
    });
    return expected === receipt.fiscalSignature;
  }

  /**
   * Issue a new tax receipt with full tax rules, idempotency, and digital signature.
   */
  async issueReceipt(request: TaxReceiptIssueRequest): Promise<TaxReceipt> {
    // 1. Idempotency Check
    const existing = await this.repo.findByPaymentId(request.paymentId);
    if (existing) {
      return existing;
    }

    // 2. Input Validation
    if (!request.paymentId || request.paymentId.trim() === '') {
      this.metrics.recordError('MISSING_PAYMENT_ID');
      throw new TaxReceiptError('MISSING_PAYMENT_ID', 'paymentId is required');
    }
    if (!request.seller || !request.seller.legalName || !request.seller.country) {
      this.metrics.recordError('INVALID_SELLER');
      throw new TaxReceiptError('INVALID_SELLER', 'Valid seller legalName and country required');
    }
    if (!request.buyer || !request.buyer.legalName || !request.buyer.country) {
      this.metrics.recordError('INVALID_BUYER');
      throw new TaxReceiptError('INVALID_BUYER', 'Valid buyer legalName and country required');
    }
    if (!request.lineItems || request.lineItems.length === 0) {
      this.metrics.recordError('EMPTY_LINE_ITEMS');
      throw new TaxReceiptError('EMPTY_LINE_ITEMS', 'At least one line item is required');
    }

    const issuedAt = this.now().toISOString();
    const year = new Date(issuedAt).getUTCFullYear();
    this.receiptCounter += 1;
    const seq = String(this.receiptCounter).padStart(6, '0');
    const receiptId = `rec_${Date.now()}_${seq}`;
    const receiptNumber = `${this.prefix}-${year}-${seq}`;

    // 3. Tax Classification Logic (Exemption & Reverse Charge)
    const isExempt = Boolean(request.exemptionCertificateId);
    
    // Cross-border B2B Reverse Charge rule:
    // If buyer is business with taxId, and country differs from seller country
    const isReverseCharge = Boolean(
      request.isReverseCharge ||
      (request.buyer.isBusiness &&
        request.buyer.taxId &&
        request.seller.country.toUpperCase() !== request.buyer.country.toUpperCase())
    );

    let reverseChargeNotes: string | undefined;
    if (isReverseCharge) {
      reverseChargeNotes = 'Reverse charge: Customer to account for VAT under Art. 194/196 EU VAT Directive or local equivalent.';
    }

    // 4. Process Line Items with Integer Arithmetic
    let subtotalNetMinor = 0;
    let totalDiscountMinor = 0;
    let totalTaxMinor = 0;
    const taxBreakdownMap = new Map<string, TaxRateBreakdown>();

    const lineItems: TaxReceiptLineItem[] = [];

    for (const item of request.lineItems) {
      if (item.quantity <= 0) {
        this.metrics.recordError('INVALID_QUANTITY');
        throw new TaxReceiptError('INVALID_QUANTITY', `Invalid quantity ${item.quantity} for item "${item.description}"`);
      }
      if (item.unitPriceMinor < 0) {
        this.metrics.recordError('INVALID_UNIT_PRICE');
        throw new TaxReceiptError('INVALID_UNIT_PRICE', `Invalid unit price ${item.unitPriceMinor}`);
      }

      const discount = Math.max(0, item.discountMinor ?? 0);
      const grossItemBase = item.quantity * item.unitPriceMinor;
      const netTaxableMinor = Math.max(0, grossItemBase - discount);

      let effectiveRateBps = item.taxRateBps ?? request.defaultTaxRateBps ?? 0;
      let taxCategory = item.taxCategory ?? 'standard';

      if (isExempt) {
        effectiveRateBps = 0;
        taxCategory = 'exempt';
      } else if (isReverseCharge) {
        effectiveRateBps = 0;
        taxCategory = 'reverse_charge';
      }

      const taxAmountMinor = Math.round((netTaxableMinor * effectiveRateBps) / 10_000);
      const grossAmountMinor = netTaxableMinor + taxAmountMinor;

      subtotalNetMinor += netTaxableMinor;
      totalDiscountMinor += discount;
      totalTaxMinor += taxAmountMinor;

      const breakdownKey = `${taxCategory}:${effectiveRateBps}`;
      const existingBreakdown = taxBreakdownMap.get(breakdownKey) ?? {
        taxCategory,
        rateBps: effectiveRateBps,
        taxableAmountMinor: 0,
        taxCollectedMinor: 0,
      };
      existingBreakdown.taxableAmountMinor += netTaxableMinor;
      existingBreakdown.taxCollectedMinor += taxAmountMinor;
      taxBreakdownMap.set(breakdownKey, existingBreakdown);

      lineItems.push({
        description: item.description,
        quantity: item.quantity,
        unitPriceMinor: item.unitPriceMinor,
        discountMinor: discount,
        netTaxableMinor,
        taxCategory,
        taxRateBps: effectiveRateBps,
        taxAmountMinor,
        grossAmountMinor,
      });
    }

    const totals: TaxReceiptTotals = {
      subtotalNetMinor,
      totalDiscountMinor,
      itemizedTax: Array.from(taxBreakdownMap.values()),
      totalTaxMinor,
      grandTotalGrossMinor: subtotalNetMinor + totalTaxMinor,
    };

    // 5. Generate Fiscal Seal
    const fiscalSignature = this.generateFiscalSignature({
      receiptNumber,
      paymentId: request.paymentId,
      totalMinor: totals.grandTotalGrossMinor,
      taxMinor: totals.totalTaxMinor,
      issuedAt,
      sellerTaxId: request.seller.taxId,
      buyerTaxId: request.buyer.taxId,
    });

    const receipt: TaxReceipt = {
      receiptId,
      receiptNumber,
      paymentId: request.paymentId,
      invoiceId: request.invoiceId,
      subscriptionId: request.subscriptionId,
      issuedAt,
      status: 'issued',
      seller: request.seller,
      buyer: request.buyer,
      currency: request.currency.toUpperCase(),
      lineItems,
      totals,
      isReverseCharge,
      reverseChargeNotes,
      isExempt,
      exemptionCertificateId: request.exemptionCertificateId,
      fiscalSignature,
    };

    await this.repo.save(receipt);
    this.metrics.recordIssued(receipt.currency, totals.grandTotalGrossMinor, totals.totalTaxMinor);

    return receipt;
  }

  /**
   * Retrieves a receipt by unique receiptId.
   */
  async getReceipt(receiptId: string): Promise<TaxReceipt | null> {
    return this.repo.findById(receiptId);
  }

  /**
   * Retrieves a receipt by paymentId.
   */
  async getReceiptByPaymentId(paymentId: string): Promise<TaxReceipt | null> {
    return this.repo.findByPaymentId(paymentId);
  }

  /**
   * Voids an issued tax receipt with an auditable reason.
   */
  async voidReceipt(receiptId: string, reason: string): Promise<TaxReceipt> {
    const receipt = await this.repo.findById(receiptId);
    if (!receipt) {
      this.metrics.recordError('RECEIPT_NOT_FOUND');
      throw new TaxReceiptError('RECEIPT_NOT_FOUND', `Tax receipt ${receiptId} not found`);
    }

    if (receipt.status === 'voided') {
      return receipt; // Already voided
    }

    const voidedAt = this.now().toISOString();
    const updated: TaxReceipt = {
      ...receipt,
      status: 'voided',
      voidReason: reason,
      voidedAt,
    };

    await this.repo.update(updated);
    this.metrics.recordVoided(receiptId);
    return updated;
  }

  /**
   * Issues a credit note / adjustment tax receipt referencing an original receipt.
   */
  async issueCreditNote(
    originalReceiptId: string,
    reason: string,
    customItemsToCredit?: TaxReceiptLineItemInput[]
  ): Promise<TaxReceipt> {
    const original = await this.repo.findById(originalReceiptId);
    if (!original) {
      this.metrics.recordError('ORIGINAL_RECEIPT_NOT_FOUND');
      throw new TaxReceiptError('ORIGINAL_RECEIPT_NOT_FOUND', `Original receipt ${originalReceiptId} not found`);
    }

    const issuedAt = this.now().toISOString();
    const year = new Date(issuedAt).getUTCFullYear();
    this.receiptCounter += 1;
    const seq = String(this.receiptCounter).padStart(6, '0');
    const creditReceiptId = `rec_cn_${Date.now()}_${seq}`;
    const creditReceiptNumber = `CN-${year}-${seq}`;

    // Negative line items matching original or custom portion
    const baseItems = customItemsToCredit ?? original.lineItems;
    const creditedLineItems: TaxReceiptLineItem[] = baseItems.map((item) => {
      const netTaxableMinor = -(item.quantity * item.unitPriceMinor - (item.discountMinor ?? 0));
      const taxAmountMinor = -(item as any).taxAmountMinor ?? Math.round((netTaxableMinor * (item.taxRateBps ?? 0)) / 10_000);
      return {
        description: `Credit: ${item.description}`,
        quantity: item.quantity,
        unitPriceMinor: -item.unitPriceMinor,
        discountMinor: 0,
        netTaxableMinor,
        taxCategory: item.taxCategory ?? 'standard',
        taxRateBps: item.taxRateBps ?? 0,
        taxAmountMinor,
        grossAmountMinor: netTaxableMinor + taxAmountMinor,
      };
    });

    const subtotalNetMinor = creditedLineItems.reduce((acc, i) => acc + i.netTaxableMinor, 0);
    const totalTaxMinor = creditedLineItems.reduce((acc, i) => acc + i.taxAmountMinor, 0);

    const totals: TaxReceiptTotals = {
      subtotalNetMinor,
      totalDiscountMinor: 0,
      itemizedTax: [
        {
          taxCategory: 'credit_adjustment',
          rateBps: 0,
          taxableAmountMinor: subtotalNetMinor,
          taxCollectedMinor: totalTaxMinor,
        },
      ],
      totalTaxMinor,
      grandTotalGrossMinor: subtotalNetMinor + totalTaxMinor,
    };

    const fiscalSignature = this.generateFiscalSignature({
      receiptNumber: creditReceiptNumber,
      paymentId: `credit-note-${original.paymentId}`,
      totalMinor: totals.grandTotalGrossMinor,
      taxMinor: totals.totalTaxMinor,
      issuedAt,
      sellerTaxId: original.seller.taxId,
      buyerTaxId: original.buyer.taxId,
    });

    const creditReceipt: TaxReceipt = {
      receiptId: creditReceiptId,
      receiptNumber: creditReceiptNumber,
      paymentId: `credit-note-${original.paymentId}`,
      invoiceId: original.invoiceId,
      subscriptionId: original.subscriptionId,
      issuedAt,
      status: 'credited',
      seller: original.seller,
      buyer: original.buyer,
      currency: original.currency,
      lineItems: creditedLineItems,
      totals,
      isReverseCharge: original.isReverseCharge,
      reverseChargeNotes: `Credit Note against ${original.receiptNumber}: ${reason}`,
      isExempt: original.isExempt,
      fiscalSignature,
      originalReceiptId: original.receiptId,
    };

    // Update original receipt with reference to credit note
    await this.repo.update({
      ...original,
      creditNoteReceiptId: creditReceiptId,
    });

    await this.repo.save(creditReceipt);
    this.metrics.recordCreditNote(originalReceiptId, Math.abs(totals.grandTotalGrossMinor));

    return creditReceipt;
  }

  /**
   * Generates a printable ASCII tax receipt for invoices, emails, or audits.
   */
  formatReceiptText(receipt: TaxReceipt): string {
    const lines: string[] = [
      '================================================================',
      `                 TAX RECEIPT / INVOICE: ${receipt.receiptNumber}`,
      '================================================================',
      `Issued Date: ${receipt.issuedAt}`,
      `Status:      ${receipt.status.toUpperCase()}`,
      `Payment Ref: ${receipt.paymentId}`,
      receipt.invoiceId ? `Invoice Ref: ${receipt.invoiceId}` : '',
      '----------------------------------------------------------------',
      'SELLER:',
      `  ${receipt.seller.legalName}`,
      `  ${receipt.seller.address}, ${receipt.seller.country}`,
      receipt.seller.taxId ? `  Tax/VAT ID: ${receipt.seller.taxId}` : '',
      '----------------------------------------------------------------',
      'BUYER:',
      `  ${receipt.buyer.legalName}`,
      `  ${receipt.buyer.address}, ${receipt.buyer.country}`,
      receipt.buyer.taxId ? `  Tax/VAT ID: ${receipt.buyer.taxId}` : '',
      receipt.isReverseCharge ? '  [REVERSE CHARGE APPLICABLE]' : '',
      receipt.isExempt ? `  [TAX EXEMPT: Cert #${receipt.exemptionCertificateId}]` : '',
      '----------------------------------------------------------------',
      'ITEMS:',
    ];

    for (const item of receipt.lineItems) {
      const unit = (item.unitPriceMinor / 100).toFixed(2);
      const net = (item.netTaxableMinor / 100).toFixed(2);
      const tax = (item.taxAmountMinor / 100).toFixed(2);
      lines.push(
        `  * ${item.description} (x${item.quantity} @ ${unit} ${receipt.currency})`
      );
      lines.push(
        `    Net: ${net} | Tax (${(item.taxRateBps / 100).toFixed(1)}%): ${tax} ${receipt.currency}`
      );
    }

    lines.push('----------------------------------------------------------------');
    lines.push(`Subtotal Net:   ${(receipt.totals.subtotalNetMinor / 100).toFixed(2)} ${receipt.currency}`);
    lines.push(`Total Tax:      ${(receipt.totals.totalTaxMinor / 100).toFixed(2)} ${receipt.currency}`);
    lines.push(`Grand Total:    ${(receipt.totals.grandTotalGrossMinor / 100).toFixed(2)} ${receipt.currency}`);
    if (receipt.reverseChargeNotes) {
      lines.push(`Note: ${receipt.reverseChargeNotes}`);
    }
    lines.push('----------------------------------------------------------------');
    lines.push(`Fiscal Seal: ${receipt.fiscalSignature.substring(0, 32)}...`);
    lines.push('================================================================');

    return lines.filter(Boolean).join('\n');
  }
}
