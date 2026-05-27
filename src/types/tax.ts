export type TaxType = 'sales_tax' | 'vat' | 'gst' | 'reverse_charge';
export type RemittanceSchedule = 'monthly' | 'quarterly' | 'annually';

export interface TaxRate {
  region: string;
  taxType: TaxType;
  rateBps: number;
  effectiveFrom: Date;
  effectiveTo?: Date;
}

export interface TaxExemption {
  subscriptionId?: string;
  customerId?: string;
  region: string;
  certificateId: string;
  validUntil: Date;
}

export interface TaxConfig {
  merchantId: string;
  ratesByRegion: TaxRate[];
  remittanceSchedule: RemittanceSchedule;
  exemptions: TaxExemption[];
  reverseChargeRegions: string[];
}

export interface TaxCalculationInput {
  subscriptionId: string;
  customerId?: string;
  region: string;
  amount: number;
  transactionDate: Date;
}

export interface TaxAmount {
  subscriptionId: string;
  region: string;
  subtotal: number;
  tax: number;
  total: number;
  taxType: TaxType;
  rateBps: number;
  exempt: boolean;
}

export interface TaxReport {
  merchantId: string;
  region: string;
  periodStart: Date;
  periodEnd: Date;
  taxableSales: number;
  taxCollected: number;
  reverseChargeTotal: number;
  transactionCount: number;
}

export interface RemittanceScheduleEntry {
  region: string;
  dueDate: Date;
  amountDue: number;
  schedule: RemittanceSchedule;
}
