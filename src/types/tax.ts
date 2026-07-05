export type TaxType = 'sales_tax' | 'vat' | 'gst' | 'reverse_charge';
export type RemittanceSchedule = 'monthly' | 'quarterly' | 'annually';
export type TaxProvider = 'BUILT_IN' | 'AVALARA' | 'TAXJAR';
export type TaxReportExportFormat = 'csv' | 'json' | 'pdf';
export type TaxSyncJobStatus = 'idle' | 'running' | 'success' | 'failed';

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
  provider: TaxProvider;
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

export interface TaxRateSyncJob {
  jobId: string;
  provider: TaxProvider;
  status: TaxSyncJobStatus;
  startedAt: Date;
  completedAt?: Date;
  syncedRegions: string[];
  failedRegions: { region: string; error: string }[];
  totalRatesUpdated: number;
}

export interface TaxExemptionUpload {
  uploadId: string;
  customerId: string;
  certificateId: string;
  issuingAuthority: string;
  validUntil: Date;
  jurisdictions: string[];
  fileUrl?: string;
  status: 'pending' | 'validated' | 'rejected';
  rejectionReason?: string;
}

export interface TaxNexusStatus {
  region: string;
  hasNexus: boolean;
  threshold: number;
  currentRevenue: number;
  percentToThreshold: number;
  lastAssessedAt: Date;
}
