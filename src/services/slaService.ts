import type {
  SlaAvailabilityEvent,
  SlaAvailabilityState,
  SlaBreach,
  SlaConfig,
  SlaDashboardReport,
  SlaStatus,
} from '../types/sla';

export const SLA_DEFAULTS = {
  uptimeTarget: 99,
  measurementInterval: 7 * 24 * 60 * 60,
} as const;

const UPSIDE_WEIGHT: Record<SlaAvailabilityState, number> = {
  healthy: 0,
  partial_outage: 0.5,
  full_outage: 1,
  maintenance: 0,
};

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Number(value.toFixed(2))));
}

/**
 * Returns true if the given UTC timestamp falls within any of the config's
 * exclusion windows (scheduled maintenance). These seconds are excluded from
 * the SLA measurement window entirely.
 */
export function isInExclusionWindow(
  timestampMs: number,
  exclusionWindows: SlaConfig['exclusionWindows'] = []
): boolean {
  if (!exclusionWindows || exclusionWindows.length === 0) return false;
  const date = new Date(timestampMs);
  const dayOfWeek = date.getUTCDay();
  const secondOfDay = date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds();
  for (const w of exclusionWindows) {
    if (w.dayOfWeek !== -1 && w.dayOfWeek !== dayOfWeek) continue;
    if (secondOfDay >= w.startSecond && secondOfDay < w.startSecond + w.durationSeconds) {
      return true;
    }
  }
  return false;
}

export function normalizeSlaConfig(merchantId: string, input: Partial<SlaConfig>): SlaConfig {
  return {
    merchantId,
    uptimeTarget: Number.isFinite(input.uptimeTarget)
      ? Number(input.uptimeTarget)
      : SLA_DEFAULTS.uptimeTarget,
    measurementInterval: Number.isFinite(input.measurementInterval)
      ? Math.max(1, Math.floor(Number(input.measurementInterval)))
      : SLA_DEFAULTS.measurementInterval,
    subscriberContacts: Array.isArray(input.subscriberContacts)
      ? [...input.subscriberContacts]
      : [],
    creditCap:
      Number.isFinite(input.creditCap) && (input.creditCap ?? 0) > 0
        ? Number(input.creditCap)
        : 0,
    exclusionWindows: Array.isArray(input.exclusionWindows)
      ? input.exclusionWindows.map((w) => ({
          label: String(w.label ?? ''),
          dayOfWeek: typeof w.dayOfWeek === 'number' ? w.dayOfWeek : -1,
          startSecond: Math.max(0, Math.floor(Number(w.startSecond ?? 0))),
          durationSeconds: Math.max(1, Math.floor(Number(w.durationSeconds ?? 1))),
        }))
      : [],
  };
}

export function calculateAvailabilityImpact(event: SlaAvailabilityEvent): {
  downtimeSeconds: number;
  partialOutageSeconds: number;
  maintenanceSeconds: number;
} {
  const downtimeSeconds = event.durationSeconds * UPSIDE_WEIGHT[event.state];
  return {
    downtimeSeconds,
    partialOutageSeconds: event.state === 'partial_outage' ? event.durationSeconds : 0,
    maintenanceSeconds: event.state === 'maintenance' ? event.durationSeconds : 0,
  };
}

export function calculateUptimePercentage(
  observedSeconds: number,
  downtimeSeconds: number
): number {
  if (observedSeconds <= 0) return 100;
  return clampPercentage(100 - (downtimeSeconds / observedSeconds) * 100);
}

export function calculateCreditAmount(
  breach: Pick<SlaBreach, 'uptimeTarget' | 'uptimePercentage' | 'measurementInterval'>,
  creditCap = 0
): number {
  if (breach.uptimePercentage >= breach.uptimeTarget) return 0;

  const deficit = breach.uptimeTarget - breach.uptimePercentage;
  const normalizedDeficit = deficit / Math.max(breach.uptimeTarget, 1);
  const rawCredit = normalizedDeficit * breach.measurementInterval * 100;
  const credit = Math.max(1, Math.round(rawCredit));
  return creditCap > 0 ? Math.min(credit, creditCap) : credit;
}

export function calculateMerchantStatus(
  config: SlaConfig,
  events: SlaAvailabilityEvent[],
  breaches: SlaBreach[],
  now: number = Date.now()
): SlaStatus {
  const windowStart = now - config.measurementInterval * 1000;

  let observedSeconds = 0;
  let downtimeSeconds = 0;
  let partialOutageSeconds = 0;
  let maintenanceSeconds = 0;

  for (const event of events) {
    const eventStart = event.timestamp;
    const eventEnd = event.timestamp + event.durationSeconds * 1000;
    const overlapStart = Math.max(eventStart, windowStart);
    const overlapEnd = Math.min(eventEnd, now);
    if (overlapEnd <= overlapStart) continue;

    // Skip events that fall within a scheduled exclusion window.
    if (isInExclusionWindow(overlapStart, config.exclusionWindows)) continue;

    const overlapSeconds = (overlapEnd - overlapStart) / 1000;
    const impact = calculateAvailabilityImpact({ ...event, durationSeconds: overlapSeconds });
    observedSeconds += overlapSeconds;
    downtimeSeconds += impact.downtimeSeconds;
    partialOutageSeconds += impact.partialOutageSeconds;
    maintenanceSeconds += impact.maintenanceSeconds;
  }

  const uptimePercentage = calculateUptimePercentage(observedSeconds, downtimeSeconds);
  const merchantBreaches = breaches.filter((breach) => breach.merchantId === config.merchantId);
  const openBreach = [...merchantBreaches].reverse().find((breach) => !breach.resolvedAt) ?? null;

  return {
    merchantId: config.merchantId,
    uptimeTarget: config.uptimeTarget,
    measurementInterval: config.measurementInterval,
    observedSeconds: Number(observedSeconds.toFixed(2)),
    uptimePercentage,
    downtimeSeconds: Number(downtimeSeconds.toFixed(2)),
    partialOutageSeconds: Number(partialOutageSeconds.toFixed(2)),
    maintenanceSeconds: Number(maintenanceSeconds.toFixed(2)),
    breachCount: merchantBreaches.length,
    activeBreachId: openBreach?.id ?? null,
    creditBalance: merchantBreaches.reduce((sum, breach) => sum + breach.creditAmount, 0),
    compliant: uptimePercentage >= config.uptimeTarget,
    lastUpdatedAt: now,
    lastBreachAt: merchantBreaches.length
      ? Math.max(...merchantBreaches.map((breach) => breach.detectedAt))
      : null,
  };
}

export interface EvaluateMerchantSnapshotInput {
  config: SlaConfig;
  events: SlaAvailabilityEvent[];
  breaches: SlaBreach[];
  now?: number;
}

export interface EvaluateMerchantSnapshotResult {
  status: SlaStatus;
  breaches: SlaBreach[];
  createdBreach: SlaBreach | null;
  resolvedBreachId: string | null;
}

export function evaluateMerchantSnapshot(
  input: EvaluateMerchantSnapshotInput
): EvaluateMerchantSnapshotResult {
  const now = input.now ?? Date.now();
  const status = calculateMerchantStatus(input.config, input.events, input.breaches, now);
  const merchantBreaches = input.breaches.filter(
    (breach) => breach.merchantId === input.config.merchantId
  );
  const activeBreach = [...merchantBreaches].reverse().find((breach) => !breach.resolvedAt) ?? null;

  if (!status.compliant && !activeBreach) {
    const breach: SlaBreach = {
      id: generateId('breach'),
      merchantId: input.config.merchantId,
      detectedAt: now,
      uptimeTarget: status.uptimeTarget,
      uptimePercentage: status.uptimePercentage,
      measurementInterval: status.measurementInterval,
      observedSeconds: status.observedSeconds,
      downtimeSeconds: status.downtimeSeconds,
      partialOutageSeconds: status.partialOutageSeconds,
      maintenanceSeconds: status.maintenanceSeconds,
      creditAmount: calculateCreditAmount({
        uptimeTarget: status.uptimeTarget,
        uptimePercentage: status.uptimePercentage,
        measurementInterval: status.measurementInterval,
      }, input.config.creditCap ?? 0),
      resolvedAt: null,
      acknowledged: false,
    };

    return {
      status: { ...status, activeBreachId: breach.id },
      breaches: [...input.breaches, breach],
      createdBreach: breach,
      resolvedBreachId: null,
    };
  }

  if (status.compliant && activeBreach) {
    const resolvedBreaches = input.breaches.map((breach) =>
      breach.id === activeBreach.id ? { ...breach, resolvedAt: now } : breach
    );

    return {
      status: { ...status, activeBreachId: null },
      breaches: resolvedBreaches,
      createdBreach: null,
      resolvedBreachId: activeBreach.id,
    };
  }

  return {
    status: { ...status, activeBreachId: activeBreach?.id ?? null },
    breaches: input.breaches,
    createdBreach: null,
    resolvedBreachId: null,
  };
}

export function buildSlaDashboardReport(input: {
  configs: Record<string, SlaConfig>;
  statuses: Record<string, SlaStatus>;
  breaches: SlaBreach[];
  events: SlaAvailabilityEvent[];
}): SlaDashboardReport {
  const merchantIds = Object.keys(input.configs);
  const summary = {
    totalMerchants: merchantIds.length,
    compliantMerchants: merchantIds.filter((merchantId) => input.statuses[merchantId]?.compliant)
      .length,
    breachCount: input.breaches.filter((breach) => !breach.resolvedAt).length,
    averageUptime: merchantIds.length
      ? Number(
          (
            merchantIds.reduce(
              (sum, merchantId) => sum + (input.statuses[merchantId]?.uptimePercentage ?? 100),
              0
            ) / merchantIds.length
          ).toFixed(2)
        )
      : 100,
    totalCreditsIssued: input.breaches.reduce((sum, breach) => sum + breach.creditAmount, 0),
    partialOutageEvents: input.events.filter((event) => event.state === 'partial_outage').length,
    maintenanceEvents: input.events.filter((event) => event.state === 'maintenance').length,
  };

  return {
    summary,
    configs: { ...input.configs },
    statuses: { ...input.statuses },
    breaches: [...input.breaches],
    events: [...input.events],
  };
}
