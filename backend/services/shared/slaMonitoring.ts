import type {
  SlaAvailabilityEvent,
  SlaAvailabilityState,
  SlaBreach,
  SlaConfig,
  SlaDashboardReport,
  SlaStatus,
  SlaDashboardSummary,
} from '../../../src/types/sla';

export interface SlaTierDefinition {
  tier: string;
  uptimeTarget: number;
  measurementInterval: number;
  responseTimeTargetMs: number;
  maxBreachCount: number;
  creditPercentage: number;
  escalationEnabled: boolean;
  autoCreditEnabled: boolean;
}

export interface SlaAnalytics {
  totalMerchants: number;
  compliantMerchants: number;
  averageUptime: number;
  totalBreaches: number;
  totalCreditsIssued: number;
  averageResponseTimeMs: number;
  uptimeByTier: Record<string, number>;
  breachTrend: Array<{ date: string; count: number }>;
  creditTrend: Array<{ date: string; amount: number }>;
  responseTimeTrend: Array<{ date: string; avgMs: number }>;
}

export interface SlaCreditRule {
  id: string;
  name: string;
  uptimeThreshold: number;
  creditPercentage: number;
  maxCreditAmount: number;
  autoApply: boolean;
  tierIds?: string[];
}

export interface SlaMonitoringEvent {
  id: string;
  merchantId: string;
  type: 'breach_detected' | 'breach_resolved' | 'credit_issued' | 'alert_sent' | 'escalation_triggered';
  timestamp: number;
  metadata: Record<string, unknown>;
}

const DEFAULT_TIER_DEFINITIONS: SlaTierDefinition[] = [
  {
    tier: 'basic',
    uptimeTarget: 99.0,
    measurementInterval: 7 * 24 * 60 * 60,
    responseTimeTargetMs: 5000,
    maxBreachCount: 3,
    creditPercentage: 5,
    escalationEnabled: false,
    autoCreditEnabled: false,
  },
  {
    tier: 'premium',
    uptimeTarget: 99.5,
    measurementInterval: 7 * 24 * 60 * 60,
    responseTimeTargetMs: 2000,
    maxBreachCount: 2,
    creditPercentage: 10,
    escalationEnabled: true,
    autoCreditEnabled: true,
  },
  {
    tier: 'enterprise',
    uptimeTarget: 99.9,
    measurementInterval: 30 * 24 * 60 * 60,
    responseTimeTargetMs: 1000,
    maxBreachCount: 1,
    creditPercentage: 20,
    escalationEnabled: true,
    autoCreditEnabled: true,
  },
];

const DEFAULT_CREDIT_RULES: SlaCreditRule[] = [
  {
    id: 'minor_breach',
    name: 'Minor Breach Credit',
    uptimeThreshold: 99.0,
    creditPercentage: 5,
    maxCreditAmount: 50,
    autoApply: true,
  },
  {
    id: 'major_breach',
    name: 'Major Breach Credit',
    uptimeThreshold: 95.0,
    creditPercentage: 15,
    maxCreditAmount: 200,
    autoApply: true,
  },
  {
    id: 'critical_breach',
    name: 'Critical Breach Credit',
    uptimeThreshold: 90.0,
    creditPercentage: 30,
    maxCreditAmount: 500,
    autoApply: true,
  },
];

export class SlaMonitoringService {
  private tierDefinitions: SlaTierDefinition[] = [...DEFAULT_TIER_DEFINITIONS];
  private creditRules: SlaCreditRule[] = [...DEFAULT_CREDIT_RULES];
  private monitoringEvents: SlaMonitoringEvent[] = [];
  private responseTimes: Map<string, Array<{ timestamp: number; responseTimeMs: number }>> = new Map();
  private merchantTiers: Map<string, string> = new Map();

  // ── Tier Management ─────────────────────────────────────────────────────

  setTierDefinition(definition: SlaTierDefinition): void {
    const idx = this.tierDefinitions.findIndex((t) => t.tier === definition.tier);
    if (idx >= 0) {
      this.tierDefinitions[idx] = definition;
    } else {
      this.tierDefinitions.push(definition);
    }
  }

  getTierDefinition(tier: string): SlaTierDefinition | undefined {
    return this.tierDefinitions.find((t) => t.tier === tier);
  }

  listTierDefinitions(): SlaTierDefinition[] {
    return [...this.tierDefinitions];
  }

  assignMerchantToTier(merchantId: string, tier: string): void {
    this.merchantTiers.set(merchantId, tier);
  }

  getMerchantTier(merchantId: string): string | undefined {
    return this.merchantTiers.get(merchantId);
  }

  getSlaConfigForTier(merchantId: string): SlaConfig | null {
    const tierId = this.merchantTiers.get(merchantId);
    if (!tierId) return null;

    const tierDef = this.tierDefinitions.find((t) => t.tier === tierId);
    if (!tierDef) return null;

    return {
      merchantId,
      uptimeTarget: tierDef.uptimeTarget,
      measurementInterval: tierDef.measurementInterval,
    };
  }

  // ── Credit Rules ────────────────────────────────────────────────────────

  addCreditRule(rule: SlaCreditRule): void {
    const idx = this.creditRules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) {
      this.creditRules[idx] = rule;
    } else {
      this.creditRules.push(rule);
    }
  }

  removeCreditRule(id: string): void {
    this.creditRules = this.creditRules.filter((r) => r.id !== id);
  }

  listCreditRules(): SlaCreditRule[] {
    return [...this.creditRules];
  }

  calculateCreditAmount(uptimePercentage: number, merchantId: string): number {
    const tierId = this.merchantTiers.get(merchantId);
    const tierDef = tierId ? this.tierDefinitions.find((t) => t.tier === tierId) : null;

    const applicableRules = [...this.creditRules]
      .filter((r) => uptimePercentage < r.uptimeThreshold)
      .sort((a, b) => b.creditPercentage - a.creditPercentage);

    if (applicableRules.length === 0) return 0;

    const rule = applicableRules[0];
    const baseCredit = rule.creditPercentage;
    const maxCredit = rule.maxCreditAmount;

    const credit = Math.min(baseCredit, maxCredit);

    if (tierDef?.autoCreditEnabled && credit > 0) {
      this.recordMonitoringEvent(merchantId, 'credit_issued', {
        amount: credit,
        uptimePercentage,
        ruleId: rule.id,
      });
    }

    return credit;
  }

  // ── Response Time Tracking ──────────────────────────────────────────────

  recordResponseTime(merchantId: string, responseTimeMs: number): void {
    const times = this.responseTimes.get(merchantId) ?? [];
    times.push({ timestamp: Date.now(), responseTimeMs });
    if (times.length > 1000) {
      times.splice(0, times.length - 1000);
    }
    this.responseTimes.set(merchantId, times);
  }

  getAverageResponseTime(merchantId: string, windowMs?: number): number {
    const times = this.responseTimes.get(merchantId) ?? [];
    if (times.length === 0) return 0;

    const cutoff = windowMs ? Date.now() - windowMs : 0;
    const filtered = times.filter((t) => t.timestamp >= cutoff);

    if (filtered.length === 0) return 0;

    const total = filtered.reduce((sum, t) => sum + t.responseTimeMs, 0);
    return total / filtered.length;
  }

  isResponseTimeBreached(merchantId: string): boolean {
    const tierId = this.merchantTiers.get(merchantId);
    if (!tierId) return false;

    const tierDef = this.tierDefinitions.find((t) => t.tier === tierId);
    if (!tierDef) return false;

    const avgResponseTime = this.getAverageResponseTime(merchantId, 24 * 60 * 60 * 1000);
    return avgResponseTime > tierDef.responseTimeTargetMs;
  }

  // ── Real-time Tracking ──────────────────────────────────────────────────

  trackAvailability(
    merchantId: string,
    state: SlaAvailabilityState,
    durationSeconds: number,
    note?: string
  ): SlaAvailabilityEvent {
    const event: SlaAvailabilityEvent = {
      id: `sla-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      merchantId,
      timestamp: Date.now(),
      durationSeconds,
      state,
      note,
    };

    if (state === 'full_outage') {
      this.recordMonitoringEvent(merchantId, 'breach_detected', {
        durationSeconds,
        state,
        note,
      });
    }

    return event;
  }

  // ── Breach Detection & Alerts ───────────────────────────────────────────

  detectBreaches(
    merchantId: string,
    config: SlaConfig,
    events: SlaAvailabilityEvent[],
    existingBreaches: SlaBreach[]
  ): { newBreaches: SlaBreach[]; resolvedBreaches: string[] } {
    const now = Date.now();
    const windowStart = now - config.measurementInterval * 1000;

    let observedSeconds = 0;
    let downtimeSeconds = 0;

    for (const event of events) {
      const eventStart = event.timestamp;
      const eventEnd = event.timestamp + event.durationSeconds * 1000;
      const overlapStart = Math.max(eventStart, windowStart);
      const overlapEnd = Math.min(eventEnd, now);

      if (overlapEnd <= overlapStart) continue;

      const overlapSeconds = (overlapEnd - overlapStart) / 1000;
      observedSeconds += overlapSeconds;

      if (event.state === 'full_outage') {
        downtimeSeconds += overlapSeconds;
      } else if (event.state === 'partial_outage') {
        downtimeSeconds += overlapSeconds * 0.5;
      }
    }

    const uptimePercentage = observedSeconds > 0
      ? Math.min(100, Math.max(0, 100 - (downtimeSeconds / observedSeconds) * 100))
      : 100;

    const isCompliant = uptimePercentage >= config.uptimeTarget;
    const activeBreach = existingBreaches.find((b) => !b.resolvedAt && b.merchantId === merchantId);
    const newBreaches: SlaBreach[] = [];
    const resolvedBreaches: string[] = [];

    if (!isCompliant && !activeBreach) {
      const creditAmount = this.calculateCreditAmount(uptimePercentage, merchantId);
      const breach: SlaBreach = {
        id: `breach-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        merchantId,
        detectedAt: now,
        uptimeTarget: config.uptimeTarget,
        uptimePercentage,
        measurementInterval: config.measurementInterval,
        observedSeconds,
        downtimeSeconds,
        partialOutageSeconds: 0,
        maintenanceSeconds: 0,
        creditAmount,
        resolvedAt: null,
        acknowledged: false,
      };
      newBreaches.push(breach);
    }

    if (isCompliant && activeBreach) {
      resolvedBreaches.push(activeBreach.id);
    }

    return { newBreaches, resolvedBreaches };
  }

  // ── Analytics ───────────────────────────────────────────────────────────

  getAnalytics(
    configs: Record<string, SlaConfig>,
    statuses: Record<string, SlaStatus>,
    breaches: SlaBreach[]
  ): SlaAnalytics {
    const merchantIds = Object.keys(configs);
    const compliantCount = merchantIds.filter((id) => statuses[id]?.compliant).length;
    const avgUptime = merchantIds.length > 0
      ? merchantIds.reduce((sum, id) => sum + (statuses[id]?.uptimePercentage ?? 100), 0) / merchantIds.length
      : 100;

    const totalBreaches = breaches.length;
    const totalCredits = breaches.reduce((sum, b) => sum + b.creditAmount, 0);

    const uptimeByTier: Record<string, number> = {};
    for (const merchantId of merchantIds) {
      const tierId = this.merchantTiers.get(merchantId) ?? 'default';
      const status = statuses[merchantId];
      if (status) {
        const current = uptimeByTier[tierId] ?? 0;
        uptimeByTier[tierId] = current + status.uptimePercentage;
      }
    }
    for (const tier of Object.keys(uptimeByTier)) {
      const tierMerchants = merchantIds.filter((id) => (this.merchantTiers.get(id) ?? 'default') === tier);
      uptimeByTier[tier] /= tierMerchants.length || 1;
    }

    const breachTrend: Array<{ date: string; count: number }> = [];
    const creditTrend: Array<{ date: string; amount: number }> = [];
    const responseTimeTrend: Array<{ date: string; avgMs: number }> = [];

    const now = Date.now();
    for (let i = 6; i >= 0; i--) {
      const dayStart = now - (i + 1) * 24 * 60 * 60 * 1000;
      const dayEnd = now - i * 24 * 60 * 60 * 1000;
      const dateStr = new Date(dayStart).toISOString().split('T')[0];

      const dayBreaches = breaches.filter(
        (b) => b.detectedAt >= dayStart && b.detectedAt < dayEnd
      );
      breachTrend.push({ date: dateStr, count: dayBreaches.length });
      creditTrend.push({
        date: dateStr,
        amount: dayBreaches.reduce((sum, b) => sum + b.creditAmount, 0),
      });
    }

    const avgResponseTime = merchantIds.length > 0
      ? merchantIds.reduce((sum, id) => sum + this.getAverageResponseTime(id, 24 * 60 * 60 * 1000), 0) / merchantIds.length
      : 0;

    return {
      totalMerchants: merchantIds.length,
      compliantMerchants: compliantCount,
      averageUptime: avgUptime,
      totalBreaches,
      totalCreditsIssued: totalCredits,
      averageResponseTimeMs: avgResponseTime,
      uptimeByTier,
      breachTrend,
      creditTrend,
      responseTimeTrend,
    };
  }

  // ── Monitoring Events ───────────────────────────────────────────────────

  private recordMonitoringEvent(
    merchantId: string,
    type: SlaMonitoringEvent['type'],
    metadata: Record<string, unknown>
  ): void {
    this.monitoringEvents.push({
      id: `mevt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      merchantId,
      type,
      timestamp: Date.now(),
      metadata,
    });
  }

  getMonitoringEvents(merchantId?: string, limit?: number): SlaMonitoringEvent[] {
    let events = merchantId
      ? this.monitoringEvents.filter((e) => e.merchantId === merchantId)
      : [...this.monitoringEvents];

    events.sort((a, b) => b.timestamp - a.timestamp);

    if (limit) {
      events = events.slice(0, limit);
    }

    return events;
  }

  // ── SLA Reporting Dashboard ─────────────────────────────────────────────

  generateSlaReport(
    configs: Record<string, SlaConfig>,
    statuses: Record<string, SlaStatus>,
    breaches: SlaBreach[],
    events: SlaAvailabilityEvent[]
  ): SlaDashboardReport {
    const merchantIds = Object.keys(configs);
    const compliantCount = merchantIds.filter((id) => statuses[id]?.compliant).length;
    const openBreaches = breaches.filter((b) => !b.resolvedAt);
    const avgUptime = merchantIds.length > 0
      ? merchantIds.reduce((sum, id) => sum + (statuses[id]?.uptimePercentage ?? 100), 0) / merchantIds.length
      : 100;

    const summary: SlaDashboardSummary = {
      totalMerchants: merchantIds.length,
      compliantMerchants: compliantCount,
      breachCount: openBreaches.length,
      averageUptime: Number(avgUptime.toFixed(2)),
      totalCreditsIssued: breaches.reduce((sum, b) => sum + b.creditAmount, 0),
      partialOutageEvents: events.filter((e) => e.state === 'partial_outage').length,
      maintenanceEvents: events.filter((e) => e.state === 'maintenance').length,
    };

    return {
      summary,
      configs: { ...configs },
      statuses: { ...statuses },
      breaches: [...breaches],
      events: [...events],
    };
  }
}

export const slaMonitoringService = new SlaMonitoringService();
