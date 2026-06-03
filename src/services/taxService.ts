import {
  RemittanceScheduleEntry,
  TaxAmount,
  TaxCalculationInput,
  TaxConfig,
  TaxRate,
  TaxReport,
} from '../types/tax';

const isRateActive = (rate: TaxRate, transactionDate: Date): boolean => {
  const time = transactionDate.getTime();
  return (
    rate.effectiveFrom.getTime() <= time &&
    (!rate.effectiveTo || rate.effectiveTo.getTime() >= time)
  );
};

export const calculateTaxAmount = (config: TaxConfig, input: TaxCalculationInput): TaxAmount => {
  const exemption = config.exemptions.find(
    (entry) =>
      entry.region === input.region &&
      entry.validUntil.getTime() >= input.transactionDate.getTime() &&
      (entry.subscriptionId === input.subscriptionId || entry.customerId === input.customerId)
  );

  const rate = config.ratesByRegion.find(
    (entry) => entry.region === input.region && isRateActive(entry, input.transactionDate)
  );

  const reverseCharge = config.reverseChargeRegions.includes(input.region);
  const rateBps = exemption || reverseCharge ? 0 : (rate?.rateBps ?? 0);
  const tax = Number(((input.amount * rateBps) / 10_000).toFixed(2));

  return {
    subscriptionId: input.subscriptionId,
    region: input.region,
    subtotal: input.amount,
    tax,
    total: Number((input.amount + tax).toFixed(2)),
    taxType: reverseCharge ? 'reverse_charge' : (rate?.taxType ?? 'sales_tax'),
    rateBps,
    exempt: Boolean(exemption),
  };
};

export const buildTaxReport = (
  config: TaxConfig,
  calculations: TaxAmount[],
  periodStart: Date,
  periodEnd: Date,
  region: string
): TaxReport => {
  const regional = calculations.filter((entry) => entry.region === region);

  return {
    merchantId: config.merchantId,
    region,
    periodStart,
    periodEnd,
    taxableSales: regional.reduce((sum, entry) => sum + (entry.exempt ? 0 : entry.subtotal), 0),
    taxCollected: regional.reduce((sum, entry) => sum + entry.tax, 0),
    reverseChargeTotal: regional
      .filter((entry) => entry.taxType === 'reverse_charge')
      .reduce((sum, entry) => sum + entry.subtotal, 0),
    transactionCount: regional.length,
  };
};

export const scheduleTaxRemittance = (
  report: TaxReport,
  schedule: TaxConfig['remittanceSchedule']
): RemittanceScheduleEntry => {
  const periodEnd = new Date(report.periodEnd);
  const dueDate = new Date(periodEnd);
  dueDate.setDate(periodEnd.getDate() + 20);

  return {
    region: report.region,
    dueDate,
    amountDue: report.taxCollected,
    schedule,
  };
};
