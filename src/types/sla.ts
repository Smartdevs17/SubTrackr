export type SlaAvailabilityState = 'healthy' | 'partial_outage' | 'full_outage' | 'maintenance';

export interface SlaConfig {
  merchantId: string;
  uptimeTarget: number;
  measurementInterval: number;
  subscriberContacts?: string[];
}

export interface SlaAvailabilityEvent {
  id: string;
  merchantId: string;
  timestamp: number;
  durationSeconds: number;
  state: SlaAvailabilityState;
  note?: string;
}

export interface SlaBreach {
  id: string;
  merchantId: string;
  detectedAt: number;
  uptimeTarget: number;
  uptimePercentage: number;
  measurementInterval: number;
  observedSeconds: number;
  downtimeSeconds: number;
  partialOutageSeconds: number;
  maintenanceSeconds: number;
  creditAmount: number;
  resolvedAt?: number | null;
  acknowledged: boolean;
}

export interface SlaStatus {
  merchantId: string;
  uptimeTarget: number;
  measurementInterval: number;
  observedSeconds: number;
  uptimePercentage: number;
  downtimeSeconds: number;
  partialOutageSeconds: number;
  maintenanceSeconds: number;
  breachCount: number;
  activeBreachId: string | null;
  creditBalance: number;
  compliant: boolean;
  lastUpdatedAt: number;
  lastBreachAt: number | null;
}

export interface SlaDashboardSummary {
  totalMerchants: number;
  compliantMerchants: number;
  breachCount: number;
  averageUptime: number;
  totalCreditsIssued: number;
  partialOutageEvents: number;
  maintenanceEvents: number;
}

export interface SlaDashboardReport {
  summary: SlaDashboardSummary;
  configs: Record<string, SlaConfig>;
  statuses: Record<string, SlaStatus>;
  breaches: SlaBreach[];
  events: SlaAvailabilityEvent[];
}
