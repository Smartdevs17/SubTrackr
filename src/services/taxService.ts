import {
  RemittanceScheduleEntry,
  TaxAmount,
  TaxCalculationInput,
  TaxConfig,
  TaxExemptionUpload,
  TaxNexusStatus,
  TaxProvider,
  TaxRate,
  TaxRateSyncJob,
  TaxReport,
  TaxSyncJobStatus,
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

// ── External Tax Provider Clients (mock/stub) ─────────────────────────────────

export class AvalaraClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly companyCode: string;

  constructor(apiKey: string, companyCode: string, baseUrl = 'https://sandbox.avatax.avalara.com') {
    this.apiKey = apiKey;
    this.companyCode = companyCode;
    this.baseUrl = baseUrl;
  }

  async lookupRate(country: string, region?: string): Promise<{ rateBps: number; taxType: TaxType }> {
    return { rateBps: 0, taxType: 'sales_tax' };
  }

  async validateCertificate(certificateId: string): Promise<{ valid: boolean }> {
    return { valid: false };
  }

  async fetchRatesForMerchant(merchantId: string): Promise<TaxRate[]> {
    return [];
  }
}

export class TaxJarClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.taxjar.com/v2') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async lookupRate(country: string, region?: string): Promise<{ rateBps: number; taxType: TaxType }> {
    return { rateBps: 0, taxType: 'sales_tax' };
  }

  async validateCertificate(certificateId: string): Promise<{ valid: boolean }> {
    return { valid: false };
  }

  async fetchRatesForMerchant(merchantId: string): Promise<TaxRate[]> {
    return [];
  }
}

// ── Tax Rate Sync Service ─────────────────────────────────────────────────────

export class TaxRateSyncService {
  private provider: TaxProvider;
  private clients: Record<TaxProvider, AvalaraClient | TaxJarClient>;

  constructor() {
    this.provider = 'BUILT_IN';
    this.clients = {
      BUILT_IN: null as unknown as AvalaraClient,
      AVALARA: new AvalaraClient('stub-api-key', 'stub-company'),
      TAXJAR: new TaxJarClient('stub-api-key'),
    };
  }

  setProvider(provider: TaxProvider, apiKey?: string, companyCode?: string): void {
    this.provider = provider;
  }

  async syncRates(regions: string[]): Promise<TaxRateSyncJob> {
    const jobId = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job: TaxRateSyncJob = {
      jobId,
      provider: this.provider,
      status: 'running',
      startedAt: new Date(),
      syncedRegions: [],
      failedRegions: [],
      totalRatesUpdated: 0,
    };

    try {
      const client = this.clients[this.provider];
      if (client) {
        const fetched = await client.fetchRatesForMerchant('default');
        job.syncedRegions = fetched.map((r) => r.region);
        job.totalRatesUpdated = fetched.length;
      }
      job.status = 'success';
      job.completedAt = new Date();
    } catch (error) {
      job.status = 'failed';
      job.failedRegions.push({
        region: regions.join(','),
        error: error instanceof Error ? error.message : 'Unknown sync error',
      });
      job.completedAt = new Date();
    }

    return job;
  }

  async lookupRate(country: string, region?: string): Promise<{ rateBps: number; taxType: TaxType }> {
    const client = this.clients[this.provider];
    if (!client) return { rateBps: 0, taxType: 'sales_tax' };
    return client.lookupRate(country, region);
  }
}

// ── Nexus Detection Service ───────────────────────────────────────────────────

export class NexusDetectionService {
  private thresholds: Map<string, number>;

  constructor() {
    this.thresholds = new Map();
  }

  setThreshold(region: string, amount: number): void {
    this.thresholds.set(region, amount);
  }

  detectNexus(region: string, cumulativeRevenue: number): TaxNexusStatus {
    const threshold = this.thresholds.get(region) ?? 0;
    const hasNexus = threshold === 0 || cumulativeRevenue >= threshold;
    const percentToThreshold = threshold > 0 ? Math.min((cumulativeRevenue / threshold) * 100, 100) : 0;

    return {
      region,
      hasNexus,
      threshold,
      currentRevenue: cumulativeRevenue,
      percentToThreshold,
      lastAssessedAt: new Date(),
    };
  }

  getNexusThreshold(region: string): number {
    return this.thresholds.get(region) ?? 0;
  }
}

// ── Exemption Certificate Service ─────────────────────────────────────────────

export class ExemptionCertificateService {
  private uploads: Map<string, TaxExemptionUpload>;

  constructor() {
    this.uploads = new Map();
  }

  uploadExemption(upload: TaxExemptionUpload): void {
    this.uploads.set(upload.uploadId, upload);
  }

  validateCertificate(uploadId: string): boolean {
    const upload = this.uploads.get(uploadId);
    if (!upload) return false;
    if (upload.validUntil < new Date()) return false;
    if (upload.status === 'rejected') return false;
    upload.status = 'validated';
    return true;
  }

  getUpload(uploadId: string): TaxExemptionUpload | undefined {
    return this.uploads.get(uploadId);
  }

  getExpiringCertificates(withinDays: number): TaxExemptionUpload[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + withinDays);
    return Array.from(this.uploads.values()).filter((u) => u.validUntil <= cutoff && u.status !== 'rejected');
  }

  rejectCertificate(uploadId: string, reason: string): void {
    const upload = this.uploads.get(uploadId);
    if (upload) {
      upload.status = 'rejected';
      upload.rejectionReason = reason;
    }
  }
}
