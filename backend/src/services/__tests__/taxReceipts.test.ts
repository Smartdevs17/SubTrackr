/**
 * backend/src/services/__tests__/taxReceipts.test.ts
 *
 * Comprehensive unit tests for TaxReceiptService.
 */

import {
  InMemoryTaxReceiptRepository,
  StructuredTaxReceiptTelemetry,
  TaxReceiptError,
  TaxReceiptService,
  type TaxEntity,
  type TaxCustomer,
} from '../taxReceipts';

const SELLER: TaxEntity = {
  legalName: 'SubTrackr Global Inc.',
  address: '100 Silicon Way, Tech City',
  country: 'US',
  taxId: 'US-EIN-987654321',
  email: 'billing@subtrackr.com',
};

const BUYER_B2C: TaxCustomer = {
  legalName: 'Alice Consumer',
  address: '12 Baker Street, London',
  country: 'GB',
  isBusiness: false,
  email: 'alice@example.com',
  customerId: 'cust_alice_1',
};

const BUYER_B2B_EU: TaxCustomer = {
  legalName: 'Acme GmbH',
  address: 'Hauptstrasse 42, Berlin',
  country: 'DE',
  isBusiness: true,
  taxId: 'DE123456789',
  email: 'finance@acme.de',
  customerId: 'cust_acme_de',
};

describe('TaxReceiptService', () => {
  let repo: InMemoryTaxReceiptRepository;
  let telemetry: StructuredTaxReceiptTelemetry;
  let service: TaxReceiptService;
  let clockTime: number;

  beforeEach(() => {
    repo = new InMemoryTaxReceiptRepository();
    telemetry = new StructuredTaxReceiptTelemetry();
    clockTime = 1_700_000_000_000;
    service = new TaxReceiptService({
      repository: repo,
      metrics: telemetry,
      now: () => new Date(clockTime),
      secretKey: 'tax-test-secret',
      receiptNumberPrefix: 'TR',
    });
  });

  describe('Standard Tax Receipt Generation', () => {
    it('generates a compliant tax receipt with correct minor unit arithmetic', async () => {
      const receipt = await service.issueReceipt({
        paymentId: 'pay_tx_1001',
        currency: 'USD',
        seller: SELLER,
        buyer: BUYER_B2C,
        defaultTaxRateBps: 2000, // 20%
        lineItems: [
          {
            description: 'SubTrackr Pro Monthly',
            quantity: 2,
            unitPriceMinor: 2000, // $20.00
            discountMinor: 500,   // $5.00 discount
          },
        ],
      });

      expect(receipt.receiptNumber).toMatch(/^TR-\d{4}-\d{6}$/);
      expect(receipt.currency).toBe('USD');
      expect(receipt.status).toBe('issued');

      // Net = 2 * 2000 - 500 = 3500 cents ($35.00)
      // Tax = 3500 * 2000 / 10000 = 700 cents ($7.00)
      // Gross = 4200 cents ($42.00)
      expect(receipt.totals.subtotalNetMinor).toBe(3500);
      expect(receipt.totals.totalDiscountMinor).toBe(500);
      expect(receipt.totals.totalTaxMinor).toBe(700);
      expect(receipt.totals.grandTotalGrossMinor).toBe(4200);

      // Verify digital seal
      expect(receipt.fiscalSignature).toBeDefined();
      expect(service.verifyReceiptAuthenticity(receipt)).toBe(true);

      const metrics = telemetry.getSnapshot();
      expect(metrics.issued).toBe(1);
      expect(metrics.grossCents).toBe(4200);
      expect(metrics.taxCents).toBe(700);
    });

    it('enforces idempotency: repeated calls for the same paymentId return identical receipt', async () => {
      const r1 = await service.issueReceipt({
        paymentId: 'pay_tx_idempotent',
        currency: 'USD',
        seller: SELLER,
        buyer: BUYER_B2C,
        lineItems: [{ description: 'Plan Upgrade', quantity: 1, unitPriceMinor: 5000 }],
      });

      const r2 = await service.issueReceipt({
        paymentId: 'pay_tx_idempotent',
        currency: 'USD',
        seller: SELLER,
        buyer: BUYER_B2C,
        lineItems: [{ description: 'Plan Upgrade', quantity: 1, unitPriceMinor: 5000 }],
      });

      expect(r1.receiptId).toBe(r2.receiptId);
      expect(r1.receiptNumber).toBe(r2.receiptNumber);
      expect(telemetry.getSnapshot().issued).toBe(1); // Only 1 issued metric counted
    });
  });

  describe('B2B Reverse Charge & Exemption Rules', () => {
    it('applies reverse charge for cross-border B2B with valid VAT ID', async () => {
      const receipt = await service.issueReceipt({
        paymentId: 'pay_b2b_de',
        currency: 'EUR',
        seller: SELLER, // US seller
        buyer: BUYER_B2B_EU, // DE business buyer
        defaultTaxRateBps: 1900,
        lineItems: [{ description: 'Enterprise License', quantity: 1, unitPriceMinor: 10000 }],
      });

      expect(receipt.isReverseCharge).toBe(true);
      expect(receipt.totals.totalTaxMinor).toBe(0);
      expect(receipt.totals.grandTotalGrossMinor).toBe(10000);
      expect(receipt.reverseChargeNotes).toContain('Art. 194/196 EU VAT Directive');
    });

    it('applies tax exemption when an exemption certificate is provided', async () => {
      const receipt = await service.issueReceipt({
        paymentId: 'pay_exempt_org',
        currency: 'USD',
        seller: SELLER,
        buyer: { ...BUYER_B2C, legalName: 'Charity Foundation', isBusiness: true },
        exemptionCertificateId: 'CERT-501C3-8899',
        defaultTaxRateBps: 850,
        lineItems: [{ description: 'Annual Non-Profit Plan', quantity: 1, unitPriceMinor: 12000 }],
      });

      expect(receipt.isExempt).toBe(true);
      expect(receipt.exemptionCertificateId).toBe('CERT-501C3-8899');
      expect(receipt.totals.totalTaxMinor).toBe(0);
      expect(receipt.totals.grandTotalGrossMinor).toBe(12000);
    });
  });

  describe('Tamper Detection & Verification', () => {
    it('detects tampering when total or fiscal fields are modified', async () => {
      const receipt = await service.issueReceipt({
        paymentId: 'pay_tamper_test',
        currency: 'USD',
        seller: SELLER,
        buyer: BUYER_B2C,
        lineItems: [{ description: 'Pro Monthly', quantity: 1, unitPriceMinor: 1000 }],
      });

      expect(service.verifyReceiptAuthenticity(receipt)).toBe(true);

      const tampered: typeof receipt = {
        ...receipt,
        totals: {
          ...receipt.totals,
          grandTotalGrossMinor: 999999,
        },
      };

      expect(service.verifyReceiptAuthenticity(tampered)).toBe(false);
    });
  });

  describe('Voiding and Credit Notes', () => {
    it('voids an issued tax receipt with an audit reason', async () => {
      const receipt = await service.issueReceipt({
        paymentId: 'pay_to_void',
        currency: 'USD',
        seller: SELLER,
        buyer: BUYER_B2C,
        lineItems: [{ description: 'Mistake Purchase', quantity: 1, unitPriceMinor: 2500 }],
      });

      const voided = await service.voidReceipt(receipt.receiptId, 'Customer billed by mistake');
      expect(voided.status).toBe('voided');
      expect(voided.voidReason).toBe('Customer billed by mistake');
      expect(voided.voidedAt).toBeDefined();

      const metrics = telemetry.getSnapshot();
      expect(metrics.voided).toBe(1);
    });

    it('issues a credit note linking back to the original receipt', async () => {
      const original = await service.issueReceipt({
        paymentId: 'pay_to_credit',
        currency: 'USD',
        seller: SELLER,
        buyer: BUYER_B2C,
        defaultTaxRateBps: 1000,
        lineItems: [{ description: 'Annual Subscription', quantity: 1, unitPriceMinor: 10000 }],
      });

      const creditNote = await service.issueCreditNote(
        original.receiptId,
        'Subscription cancelled during refund window'
      );

      expect(creditNote.status).toBe('credited');
      expect(creditNote.receiptNumber).toMatch(/^CN-\d{4}-\d{6}$/);
      expect(creditNote.originalReceiptId).toBe(original.receiptId);
      expect(creditNote.totals.grandTotalGrossMinor).toBeLessThan(0);

      // Verify updated original receipt has link to credit note
      const updatedOriginal = await service.getReceipt(original.receiptId);
      expect(updatedOriginal?.creditNoteReceiptId).toBe(creditNote.receiptId);

      const metrics = telemetry.getSnapshot();
      expect(metrics.creditNotes).toBe(1);
    });
  });

  describe('Formatting and Failure Modes', () => {
    it('formats a clean ASCII receipt string for emails and audits', async () => {
      const receipt = await service.issueReceipt({
        paymentId: 'pay_format_test',
        currency: 'USD',
        seller: SELLER,
        buyer: BUYER_B2C,
        defaultTaxRateBps: 2000,
        lineItems: [{ description: 'SubTrackr Starter', quantity: 1, unitPriceMinor: 1500 }],
      });

      const text = service.formatReceiptText(receipt);
      expect(text).toContain('TAX RECEIPT / INVOICE:');
      expect(text).toContain(receipt.receiptNumber);
      expect(text).toContain('SubTrackr Starter');
      expect(text).toContain('Grand Total:');
      expect(text).toContain('Fiscal Seal:');
    });

    it('rejects invalid inputs with descriptive TaxReceiptError codes', async () => {
      await expect(
        service.issueReceipt({
          paymentId: '',
          currency: 'USD',
          seller: SELLER,
          buyer: BUYER_B2C,
          lineItems: [{ description: 'Item', quantity: 1, unitPriceMinor: 1000 }],
        })
      ).rejects.toThrow(TaxReceiptError);

      await expect(
        service.issueReceipt({
          paymentId: 'pay_empty_items',
          currency: 'USD',
          seller: SELLER,
          buyer: BUYER_B2C,
          lineItems: [],
        })
      ).rejects.toThrow(TaxReceiptError);

      await expect(
        service.issueReceipt({
          paymentId: 'pay_neg_qty',
          currency: 'USD',
          seller: SELLER,
          buyer: BUYER_B2C,
          lineItems: [{ description: 'Item', quantity: -1, unitPriceMinor: 1000 }],
        })
      ).rejects.toThrow(TaxReceiptError);
    });
  });
});
