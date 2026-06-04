import { create } from 'zustand';
import { buildTaxReport, calculateTaxAmount, scheduleTaxRemittance } from '../services/taxService';
import {
  RemittanceScheduleEntry,
  TaxAmount,
  TaxCalculationInput,
  TaxConfig,
  TaxRate,
  TaxReport,
} from '../types/tax';

interface TaxState {
  config: TaxConfig;
  calculations: TaxAmount[];
  reports: TaxReport[];
  remittances: RemittanceScheduleEntry[];
  addRate: (rate: TaxRate) => void;
  addExemption: (exemption: TaxConfig['exemptions'][number]) => void;
  calculateTax: (input: TaxCalculationInput) => TaxAmount;
  createReport: (region: string, periodStart: Date, periodEnd: Date) => TaxReport;
  setReverseChargeRegions: (regions: string[]) => void;
}

export const useTaxStore = create<TaxState>((set, get) => ({
  config: {
    merchantId: 'default-merchant',
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
    exemptions: [],
    reverseChargeRegions: [],
  },
  calculations: [],
  reports: [],
  remittances: [],

  addRate: (rate) =>
    set((state) => ({
      config: { ...state.config, ratesByRegion: [...state.config.ratesByRegion, rate] },
    })),

  addExemption: (exemption) =>
    set((state) => ({
      config: { ...state.config, exemptions: [...state.config.exemptions, exemption] },
    })),

  calculateTax: (input) => {
    const result = calculateTaxAmount(get().config, input);
    set((state) => ({ calculations: [...state.calculations, result] }));
    return result;
  },

  createReport: (region, periodStart, periodEnd) => {
    const report = buildTaxReport(get().config, get().calculations, periodStart, periodEnd, region);
    const remittance = scheduleTaxRemittance(report, get().config.remittanceSchedule);
    set((state) => ({
      reports: [...state.reports, report],
      remittances: [...state.remittances, remittance],
    }));
    return report;
  },

  setReverseChargeRegions: (regions) =>
    set((state) => ({ config: { ...state.config, reverseChargeRegions: regions } })),
}));
