import { buildTaxReport, calculateTaxAmount, scheduleTaxRemittance } from '../taxService';
import { TaxConfig } from '../../types/tax';

const config: TaxConfig = {
  merchantId: 'merchant-1',
  ratesByRegion: [
    {
      region: 'US-CA',
      taxType: 'sales_tax',
      rateBps: 725,
      effectiveFrom: new Date('2024-01-01T00:00:00.000Z'),
    },
    {
      region: 'EU-DE',
      taxType: 'vat',
      rateBps: 1900,
      effectiveFrom: new Date('2024-01-01T00:00:00.000Z'),
    },
  ],
  remittanceSchedule: 'monthly',
  exemptions: [
    {
      subscriptionId: 'exempt-sub',
      region: 'US-CA',
      certificateId: 'CERT-1',
      validUntil: new Date('2027-01-01T00:00:00.000Z'),
    },
  ],
  reverseChargeRegions: ['EU-DE'],
};

describe('taxService', () => {
  it('calculates tax for active regional rates', () => {
    const tax = calculateTaxAmount(config, {
      subscriptionId: 'sub-1',
      region: 'US-CA',
      amount: 100,
      transactionDate: new Date('2026-05-01T00:00:00.000Z'),
    });

    expect(tax.tax).toBe(7.25);
    expect(tax.total).toBe(107.25);
    expect(tax.exempt).toBe(false);
  });

  it('handles exemptions and reverse charge regions', () => {
    const exempt = calculateTaxAmount(config, {
      subscriptionId: 'exempt-sub',
      region: 'US-CA',
      amount: 100,
      transactionDate: new Date('2026-05-01T00:00:00.000Z'),
    });
    const reverseCharge = calculateTaxAmount(config, {
      subscriptionId: 'sub-2',
      region: 'EU-DE',
      amount: 100,
      transactionDate: new Date('2026-05-01T00:00:00.000Z'),
    });

    expect(exempt.tax).toBe(0);
    expect(exempt.exempt).toBe(true);
    expect(reverseCharge.taxType).toBe('reverse_charge');
    expect(reverseCharge.tax).toBe(0);
  });

  it('builds regional reports and remittance schedules', () => {
    const calculations = [
      calculateTaxAmount(config, {
        subscriptionId: 'sub-1',
        region: 'US-CA',
        amount: 100,
        transactionDate: new Date('2026-05-01T00:00:00.000Z'),
      }),
    ];
    const report = buildTaxReport(
      config,
      calculations,
      new Date('2026-05-01T00:00:00.000Z'),
      new Date('2026-05-31T00:00:00.000Z'),
      'US-CA'
    );
    const remittance = scheduleTaxRemittance(report, 'monthly');

    expect(report.taxCollected).toBe(7.25);
    expect(report.transactionCount).toBe(1);
    expect(remittance.amountDue).toBe(7.25);
  });
});
