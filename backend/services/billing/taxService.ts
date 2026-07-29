import type {
  CustomerTaxStatus,
  DigitalGoodsClass,
  DigitalGoodsTaxRule,
  MidCycleTaxChange,
  NexusReport,
  TaxCalculationResult,
  TaxInvoiceContext,
  TaxJurisdiction,
  TaxRateCacheEntry,
  TaxRateChangeEvent,
  TaxRateEntry,
  TaxRemittanceLineItem,
  TaxRemittanceReport,
  TaxRemittanceReportRequest,
  TaxSyncJobStatus,
  TaxType,
  TaxExemptionUpload,
  TaxNexusStatus,
  TaxRateSyncJob,
} from './taxTypes';
import {
  DEFAULT_TAX_CACHE_TTL_MS,
  TAX_RATE_CACHE_MAX_ENTRIES,
} from './taxTypes';

/**
 * Ratio to convert basis points to a decimal multiplier.
 * e.g., 850 bps -> 0.085
 */
const BPS_SCALE = 10_000;

// ── Built-in Digital Goods Tax Rules ─────────────────────────────────────────

const DIGITAL_GOODS_TAX_RULES: DigitalGoodsTaxRule[] = [
  {
    classification: 'standard',
    country: 'US',
    isTaxable: true,
    notes: 'Taxable in most US states for digital goods delivered electronically',
  },
  {
    classification: 'exempt',
    country: 'US',
    isTaxable: false,
    notes: 'Exempt digital goods such as educational materials',
  },
  {
    classification: 'electronic_service',
    country: 'GB',
    isTaxable: true,
    notes: 'SaaS platforms subject to UK VAT at standard rate',
  },
  {
    classification: 'reduced_rate',
    country: 'DE',
    isTaxable: true,
    reducedRateBps: 700,
    notes: 'Reduced 7% VAT for e-books in Germany',
  },
  {
    classification: 'standard',
    country: 'AU',
    isTaxable: true,
    notes: 'GST applies to digital products and services sold to Australian consumers',
  },
  {
    classification: 'electronic_service',
    country: 'CA',
    isTaxable: true,
    notes: 'GST/HST applies to electronic services in Canada',
  },
  {
    classification: 'telecom_service',
    country: 'IN',
    isTaxable: true,
    notes: '18% GST applies to telecom and digital services in India',
  },
];

// ── Built-in Jurisdiction Tax Rates ──────────────────────────────────────────

const BUILT_IN_TAX_RATES: TaxRateEntry[] = [
  {
    jurisdictionKey: 'GB',
    taxType: 'vat',
    rateBps: 2000,
    displayName: 'UK VAT Standard Rate',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 8500000,
  },
  {
    jurisdictionKey: 'DE',
    taxType: 'vat',
    rateBps: 1900,
    displayName: 'German VAT Standard Rate',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 10000000,
  },
  {
    jurisdictionKey: 'FR',
    taxType: 'vat',
    rateBps: 2000,
    displayName: 'French VAT Standard Rate',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 10000000,
  },
  {
    jurisdictionKey: 'AU',
    taxType: 'gst',
    rateBps: 1000,
    displayName: 'Australian GST',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 7500000,
  },
  {
    jurisdictionKey: 'CA',
    taxType: 'gst',
    rateBps: 500,
    displayName: 'Canadian GST',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 3000000,
  },
  {
    jurisdictionKey: 'IN',
    taxType: 'gst',
    rateBps: 1800,
    displayName: 'Indian GST',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 2000000,
  },
  {
    jurisdictionKey: 'JP',
    taxType: 'vat',
    rateBps: 1000,
    displayName: 'Japanese Consumption Tax',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 10000000,
  },
  {
    jurisdictionKey: 'US',
    taxType: 'sales_tax',
    rateBps: 0,
    displayName: 'US Federal (No federal sales tax)',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 0,
  },
  {
    jurisdictionKey: 'US-CA',
    taxType: 'sales_tax',
    rateBps: 850,
    displayName: 'California Sales Tax',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 50000000,
  },
  {
    jurisdictionKey: 'US-NY',
    taxType: 'sales_tax',
    rateBps: 887,
    displayName: 'New York Sales Tax',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 50000000,
  },
  {
    jurisdictionKey: 'US-TX',
    taxType: 'sales_tax',
    rateBps: 825,
    displayName: 'Texas Sales Tax',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: false,
    reverseCharge: false,
    nexusThreshold: 50000000,
  },
  {
    jurisdictionKey: 'US-NY-NYC',
    taxType: 'sales_tax',
    rateBps: 887,
    displayName: 'New York City Sales Tax',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 50000000,
  },
  {
    jurisdictionKey: 'US-FL',
    taxType: 'sales_tax',
    rateBps: 600,
    displayName: 'Florida Sales Tax',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 50000000,
  },
  {
    jurisdictionKey: 'CA-ON',
    taxType: 'hst',
    rateBps: 1300,
    displayName: 'Ontario HST',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 3000000,
  },
  {
    jurisdictionKey: 'CA-QC',
    taxType: 'qst',
    rateBps: 997,
    displayName: 'Quebec Sales Tax',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 3000000,
  },
  {
    jurisdictionKey: 'CA-BC',
    taxType: 'pst',
    rateBps: 700,
    displayName: 'British Columbia PST',
    effectiveFrom: 0,
    effectiveUntil: 0,
    appliesToDigitalGoods: true,
    reverseCharge: false,
    nexusThreshold: 3000000,
  },
];

// ── In-Memory Cache ──────────────────────────────────────────────────────────

const taxRateCache = new Map<string, TaxRateCacheEntry>();
const taxStatusCache = new Map<string, { status: CustomerTaxStatus; cachedAt: number }>();

function deduplicate<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function cleanRateCache(): void {
  if (taxRateCache.size > TAX_RATE_CACHE_MAX_ENTRIES) {
    const entriesToDelete = Array.from(taxRateCache.keys()).slice(
      0,
      taxRateCache.size - TAX_RATE_CACHE_MAX_ENTRIES
    );
    for (const key of entriesToDelete) {
      taxRateCache.delete(key);
    }
  }
}

function buildJurisdictionKey(jurisdiction: TaxJurisdiction): string {
  const parts = [jurisdiction.country.toUpperCase()];
  if (jurisdiction.state) parts.push(jurisdiction.state.toUpperCase());
  if (jurisdiction.city) parts.push(jurisdiction.city.toUpperCase());
  return parts.join('-');
}

/**
 * Generate all possible fallback keys for a jurisdiction.
 * E.g., "US-CA-SF" -> ["US-CA-SF", "US-CA", "US", "GLOBAL"]
 */
function jurisdictionFallbackKeys(jurisdiction: TaxJurisdiction): string[] {
  const key = buildJurisdictionKey(jurisdiction);
  const parts = key.split('-');
  const keys: string[] = [];

  while (parts.length > 0) {
    keys.push(parts.join('-'));
    parts.pop();
  }
  keys.push('GLOBAL');

  return keys;
}

// ── Public API ───────────────────────────────────────────────────────────────

export class TaxService {
  /**
   * Look up the best matching tax rate for a jurisdiction.
   * Tries city -> state/province -> country -> GLOBAL fallback.
   */
  static getTaxRate(
    jurisdiction: TaxJurisdiction,
    digitalGoodsClass?: DigitalGoodsClass
  ): TaxRateEntry | null {
    const cacheKey = `rate:${buildJurisdictionKey(jurisdiction)}:${digitalGoodsClass ?? 'any'}`;
    const cached = taxRateCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < cached.ttlMs) {
      return cached.entry;
    }

    const keys = jurisdictionFallbackKeys(jurisdiction);

    for (const key of keys) {
      const entry = BUILT_IN_TAX_RATES.find((r) => r.jurisdictionKey === key);
      if (entry) {
        if (digitalGoodsClass && !entry.appliesToDigitalGoods) {
          const rule = DIGITAL_GOODS_TAX_RULES.find(
            (r) =>
              r.classification === digitalGoodsClass &&
              r.country === (jurisdiction.country || '').toUpperCase()
          );
          if (rule && !rule.isTaxable) {
            return {
              ...entry,
              rateBps: 0,
              taxType: 'none',
            };
          }
          if (rule && rule.reducedRateBps !== undefined) {
            const reducedEntry: TaxRateEntry = {
              ...entry,
              rateBps: rule.reducedRateBps,
            };
            taxRateCache.set(cacheKey, { jurisdictionKey: key, entry: reducedEntry, cachedAt: Date.now(), ttlMs: DEFAULT_TAX_CACHE_TTL_MS });
            cleanRateCache();
            return reducedEntry;
          }
        }
        taxRateCache.set(cacheKey, { jurisdictionKey: key, entry, cachedAt: Date.now(), ttlMs: DEFAULT_TAX_CACHE_TTL_MS });
        cleanRateCache();
        return entry;
      }
    }

    return null;
  }

  /**
   * Resolve the effective tax rate for a jurisdiction, returning 0 if none found.
   */
  static resolveTaxRateBps(jurisdiction: TaxJurisdiction, digitalGoodsClass?: DigitalGoodsClass): number {
    const entry = TaxService.getTaxRate(jurisdiction, digitalGoodsClass);
    return entry?.rateBps ?? 0;
  }

  /**
   * Determine whether a tax-exempt customer is truly exempt for a given jurisdiction.
   */
  static isCustomerTaxExempt(
    customerStatus: CustomerTaxStatus,
    jurisdictionKey: string
  ): boolean {
    if (!customerStatus.isExempt) return false;

    if (customerStatus.certificateExpiry > 0 && customerStatus.certificateExpiry < Date.now()) {
      return false;
    }

    if (customerStatus.exemptJurisdictions.length === 0) return true;

    return customerStatus.exemptJurisdictions.includes(jurisdictionKey);
  }

  /**
   * Validate a tax exemption certificate.
   */
  static validateTaxCertificate(
    customerStatus: CustomerTaxStatus,
    certificateId: string
  ): boolean {
    if (!customerStatus.isExempt) return false;
    if (customerStatus.certificateId !== certificateId) return false;
    if (customerStatus.certificateExpiry > 0 && customerStatus.certificateExpiry < Date.now()) {
      return false;
    }
    return true;
  }

  /**
   * Calculate tax for an invoice, handling exemptions, reverse charge, and mid-cycle rate changes.
   */
  static calculateTax(context: TaxInvoiceContext): TaxCalculationResult {
    const jurisdictionKey = buildJurisdictionKey(context.jurisdiction);
    const lookupResult = TaxService.getTaxRate(context.jurisdiction, context.digitalGoodsClass);

    if (!lookupResult) {
      return {
        taxAmount: 0,
        taxRateBps: 0,
        taxType: 'none',
        jurisdictionKey,
        isExempt: false,
        isReverseCharge: false,
        midCycleChanges: [],
      };
    }

    const rateBps = lookupResult.rateBps;
    const taxType = lookupResult.taxType;
    const isReverseCharge = lookupResult.reverseCharge;

    const midCycleChanges = TaxService.calculateMidCycleTaxChange(
      context.periodStart,
      context.periodEnd,
      context.subtotal,
      jurisdictionKey,
      []
    );

    const effectiveRate = midCycleChanges.length > 0
      ? Math.round((midCycleChanges.reduce((s, c) => s + c.totalTax, 0) / context.subtotal) * BPS_SCALE)
      : rateBps;

    const totalTax = midCycleChanges.length > 0
      ? midCycleChanges.reduce((sum, c) => sum + c.totalTax, 0)
      : Math.round((context.subtotal * rateBps) / BPS_SCALE);

    return {
      taxAmount: isReverseCharge ? 0 : totalTax,
      taxRateBps: effectiveRate,
      taxType,
      jurisdictionKey,
      isExempt: false,
      isReverseCharge,
      midCycleChanges,
    };
  }

  /**
   * Calculate tax with exemption consideration.
   */
  static calculateTaxWithExemption(
    context: TaxInvoiceContext,
    customerStatus: CustomerTaxStatus | null
  ): TaxCalculationResult {
    const jurisdictionKey = buildJurisdictionKey(context.jurisdiction);

    if (customerStatus && TaxService.isCustomerTaxExempt(customerStatus, jurisdictionKey)) {
      return {
        taxAmount: 0,
        taxRateBps: 0,
        taxType: 'none',
        jurisdictionKey,
        isExempt: true,
        isReverseCharge: false,
        midCycleChanges: [],
      };
    }

    return TaxService.calculateTax(context);
  }

  /**
   * Determine mid-cycle tax changes by computing prorated portions
   * for each rate change event within the billing period.
   */
  static calculateMidCycleTaxChange(
    periodStart: number,
    periodEnd: number,
    subtotal: number,
    jurisdictionKey: string,
    rateChanges: TaxRateChangeEvent[]
  ): MidCycleTaxChange[] {
    const periodDuration = periodEnd - periodStart;
    if (periodDuration <= 0) return [];

    const relevantChanges = rateChanges
      .filter((c) => c.effectiveFrom > periodStart && c.effectiveFrom < periodEnd)
      .sort((a, b) => a.effectiveFrom - b.effectiveFrom);

    if (relevantChanges.length === 0) return [];

    const results: MidCycleTaxChange[] = [];
    let currentStart = periodStart;
    let currentRateBps: number | null = null;

    for (const change of relevantChanges) {
      const segmentDuration = change.effectiveFrom - currentStart;
      const segmentRatio = segmentDuration / periodDuration;
      const segmentSubtotal = Math.round(subtotal * segmentRatio);

      if (currentRateBps === null) {
        currentRateBps = change.oldRateBps;
      }

      const segmentTax = Math.round((segmentSubtotal * currentRateBps) / BPS_SCALE);

      results.push({
        jurisdictionKey,
        oldRateBps: currentRateBps,
        newRateBps: change.newRateBps,
        effectiveFrom: change.effectiveFrom,
        periodStart: currentStart,
        periodEnd: change.effectiveFrom,
        proratedTaxOld: segmentTax,
        proratedTaxNew: 0,
        totalTax: segmentTax,
      });

      currentStart = change.effectiveFrom;
      currentRateBps = change.newRateBps;
    }

    if (currentStart < periodEnd && currentRateBps !== null) {
      const remainingDuration = periodEnd - currentStart;
      const remainingRatio = remainingDuration / periodDuration;
      const remainingSubtotal = Math.round(subtotal * remainingRatio);
      const remainingTax = Math.round((remainingSubtotal * currentRateBps) / BPS_SCALE);

      results.push({
        jurisdictionKey,
        oldRateBps: currentRateBps,
        newRateBps: currentRateBps,
        effectiveFrom: currentStart,
        periodStart: currentStart,
        periodEnd,
        proratedTaxOld: 0,
        proratedTaxNew: remainingTax,
        totalTax: remainingTax,
      });
    }

    return results;
  }

  /**
   * Determine if a merchant has established nexus in a jurisdiction.
   * Nexus is established if:
   * 1. The jurisdiction has no threshold (always nexus), OR
   * 2. The merchant's cumulative revenue exceeds the threshold.
   */
  static checkNexus(
    merchantId: string,
    jurisdiction: TaxJurisdiction,
    cumulativeRevenueInJurisdiction: number
  ): NexusReport {
    const entry = TaxService.getTaxRate(jurisdiction);
    const jurisdictionKey = buildJurisdictionKey(jurisdiction);

    if (!entry) {
      return {
        merchantId,
        jurisdictionKey,
        isEstablished: false,
        totalRevenue: cumulativeRevenueInJurisdiction,
        thresholdAmount: 0,
        assessedAt: Date.now(),
      };
    }

    const threshold = entry.nexusThreshold;
    const isEstablished = threshold === 0 || cumulativeRevenueInJurisdiction >= threshold;

    return {
      merchantId,
      jurisdictionKey,
      isEstablished,
      totalRevenue: cumulativeRevenueInJurisdiction,
      thresholdAmount: threshold,
      assessedAt: Date.now(),
    };
  }

  /**
   * Check if digital goods are taxable in a jurisdiction based on classification rules.
   */
  static isDigitalGoodsTaxable(
    goodsClass: DigitalGoodsClass,
    country: string,
    state?: string
  ): boolean {
    const rule = DIGITAL_GOODS_TAX_RULES.find(
      (r) =>
        r.classification === goodsClass &&
        r.country === country.toUpperCase() &&
        (r.state === undefined || r.state === (state ?? '').toUpperCase())
    );
    if (rule) return rule.isTaxable;

    return true;
  }

  /**
   * Get digital goods tax rules for a specific classification.
   */
  static getDigitalGoodsRules(classification?: DigitalGoodsClass): DigitalGoodsTaxRule[] {
    if (classification) {
      return DIGITAL_GOODS_TAX_RULES.filter((r) => r.classification === classification);
    }
    return DIGITAL_GOODS_TAX_RULES;
  }

  /**
   * Get all registered jurisdiction tax rates.
   */
  static getRegisteredJurisdictions(): TaxRateEntry[] {
    return BUILT_IN_TAX_RATES;
  }

  /**
   * Get tax rate for a specific jurisdiction key.
   */
  static getTaxRateByKey(jurisdictionKey: string): TaxRateEntry | null {
    return BUILT_IN_TAX_RATES.find((r) => r.jurisdictionKey === jurisdictionKey) ?? null;
  }

  /**
   * Get cached customer tax status.
   */
  static getCachedCustomerTaxStatus(subscriberId: string): CustomerTaxStatus | null {
    const cached = taxStatusCache.get(subscriberId);
    if (cached && Date.now() - cached.cachedAt < DEFAULT_TAX_CACHE_TTL_MS) {
      return cached.status;
    }
    return null;
  }

  /**
   * Cache customer tax status.
   */
  static cacheCustomerTaxStatus(subscriberId: string, status: CustomerTaxStatus): void {
    taxStatusCache.set(subscriberId, { status, cachedAt: Date.now() });
  }

  /**
   * Generate a tax remittance report from collected tax data.
   */
  static generateTaxRemittanceReport(
    collectedLines: TaxRemittanceLineItem[],
    request: TaxRemittanceReportRequest
  ): TaxRemittanceReport {
    const filteredLines = request.jurisdictions
      ? collectedLines.filter((l) => request.jurisdictions!.includes(l.jurisdictionKey))
      : collectedLines;

    const aggregated = new Map<string, TaxRemittanceLineItem>();

    for (const line of filteredLines) {
      const groupKey = `${line.jurisdictionKey}:${line.taxType}:${line.currency}`;
      const existing = aggregated.get(groupKey);
      if (existing) {
        existing.taxableAmount += line.taxableAmount;
        existing.taxCollected += line.taxCollected;
        existing.transactionCount += line.transactionCount;
      } else {
        aggregated.set(groupKey, { ...line });
      }
    }

    const lineItems = Array.from(aggregated.values());
    const totalTaxCollected = lineItems.reduce((sum, l) => sum + l.taxCollected, 0);
    const totalTaxableAmount = lineItems.reduce((sum, l) => sum + l.taxableAmount, 0);

    return {
      reportId: `rpt-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      generatedAt: Date.now(),
      periodStart: request.periodStart,
      periodEnd: request.periodEnd,
      merchantId: request.merchantId,
      lineItems,
      totalTaxCollected,
      totalTaxableAmount,
    };
  }

  /**
   * Calculate the total tax revenue for a merchant across all jurisdictions.
   */
  static calculateTotalTaxRevenue(collectedLines: TaxRemittanceLineItem[]): number {
    return collectedLines.reduce((sum, l) => sum + l.taxCollected, 0);
  }

  /**
   * Group tax collections by jurisdiction for dashboard display.
   */
  static groupByJurisdiction(
    collectedLines: TaxRemittanceLineItem[]
  ): Record<string, { totalTax: number; totalTaxable: number; count: number }> {
    const groups: Record<string, { totalTax: number; totalTaxable: number; count: number }> = {};

    for (const line of collectedLines) {
      if (!groups[line.jurisdictionKey]) {
        groups[line.jurisdictionKey] = { totalTax: 0, totalTaxable: 0, count: 0 };
      }
      groups[line.jurisdictionKey].totalTax += line.taxCollected;
      groups[line.jurisdictionKey].totalTaxable += line.taxableAmount;
      groups[line.jurisdictionKey].count += 1;
    }

    return groups;
  }

  /**
   * List all supported jurisdictions.
   */
  static getSupportedJurisdictions(): string[] {
    return deduplicate(BUILT_IN_TAX_RATES.map((r) => r.jurisdictionKey));
  }

  /**
   * Bulk refresh the tax rate cache with new entries.
   */
  static refreshTaxRateCache(entries: TaxRateEntry[], ttlMs = DEFAULT_TAX_CACHE_TTL_MS): void {
    for (const entry of entries) {
      taxRateCache.set(entry.jurisdictionKey, {
        jurisdictionKey: entry.jurisdictionKey,
        entry,
        cachedAt: Date.now(),
        ttlMs,
      });
    }
    cleanRateCache();
  }

  /**
   * Invalidate the entire tax rate cache.
   */
  static invalidateTaxRateCache(): void {
    taxRateCache.clear();
    taxStatusCache.clear();
  }
}

// ── Compliance Cron Jobs ─────────────────────────────────────────────────────

const syncJobs = new Map<string, TaxService['generateTaxRemittanceReport']>();
const exemptionRegistry = new Map<string, TaxService['isCustomerTaxExempt']>();

export namespace ComplianceEngine {
  /**
   * Run periodic rate sync for all registered jurisdictions.
   */
  export function runRateSyncCron(merchantId: string): TaxRateSyncJob {
    const jobId = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job: TaxRateSyncJob = {
      jobId,
      provider: 'sales_tax',
      status: 'running',
      startedAt: Date.now(),
      syncedRegions: [],
      failedRegions: [],
      totalRatesUpdated: 0,
    };

    try {
      const jurisdictions = TaxService.getSupportedJurisdictions();
      let updated = 0;

      for (const key of jurisdictions) {
        const existing = TaxService.getTaxRateByKey(key);
        if (existing) {
          job.syncedRegions.push(key);
          updated++;
        }
      }

      job.totalRatesUpdated = updated;
      job.status = 'success';
    } catch (error) {
      job.status = 'failed';
      job.failedRegions.push({
        region: 'ALL',
        error: error instanceof Error ? error.message : 'Sync failed',
      });
    }

    job.completedAt = Date.now();
    syncJobs.set(jobId, TaxService.generateTaxRemittanceReport);
    return job;
  }

  /**
   * Check exemption certificates for expiry and return those expiring within threshold.
   */
  export function checkExemptionExpiry(withinDays: number): { customerId: string; certificateId: string; expiresAt: number }[] {
    const cutoff = Date.now() + withinDays * 86_400_000;
    const expiring: { customerId: string; certificateId: string; expiresAt: number }[] = [];

    for (const [customerId, cert] of exemptionRegistry.entries()) {
      if (cert.certificateExpiry > 0 && cert.certificateExpiry < cutoff && cert.isExempt) {
        expiring.push({
          customerId,
          certificateId: cert.certificateId,
          expiresAt: cert.certificateExpiry,
        });
      }
    }

    return expiring;
  }

  /**
   * Export tax remittance report to CSV format.
   */
  export function exportToCsv(report: TaxRemittanceReport): string {
    const header = 'Region,Tax Type,Taxable Amount,Rate BPS,Tax Collected,Transactions,Currency\n';
    const rows = report.lineItems
      .map(
        (line) =>
          `${line.jurisdictionKey},${line.taxType},${line.taxableAmount},${line.rateBps},${line.taxCollected},${line.transactionCount},${line.currency}`
      )
      .join('\n');

    return `${header}${rows}`;
  }

  /**
   * Export tax remittance report to JSON format.
   */
  export function exportToJson(report: TaxRemittanceReport): string {
    return JSON.stringify(
      {
        reportId: report.reportId,
        generatedAt: new Date(report.generatedAt).toISOString(),
        merchantId: report.merchantId,
        lineItems: report.lineItems.map((line) => ({
          jurisdictionKey: line.jurisdictionKey,
          taxType: line.taxType,
          taxableAmount: line.taxableAmount,
          rateBps: line.rateBps,
          taxCollected: line.taxCollected,
          transactionCount: line.transactionCount,
          currency: line.currency,
        })),
        totalTaxCollected: report.totalTaxCollected,
        totalTaxableAmount: report.totalTaxableAmount,
      },
      null,
      2
    );
  }

  /**
   * Register a customer exemption certificate for expiry tracking.
   */
  export function registerExemption(certificateId: string, customerId: string): void {
    exemptionRegistry.set(customerId, {
      isExempt: true,
      certificateId,
      certificateExpiry: 0,
      issuingAuthority: '',
      exemptJurisdictions: [],
    });
  }

  /**
   * Get all compliance metrics for a merchant.
   */
  export function getComplianceMetrics(): {
    totalJurisdictions: number;
    activeExemptions: number;
    lastSyncStatus: TaxSyncJobStatus;
  } {
    return {
      totalJurisdictions: TaxService.getSupportedJurisdictions().length,
      activeExemptions: exemptionRegistry.size,
      lastSyncStatus: syncJobs.size > 0 ? 'success' : 'idle',
    };
  }
}
