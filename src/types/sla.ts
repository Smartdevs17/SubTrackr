export type SlaAvailabilityState = 'healthy' | 'partial_outage' | 'full_outage' | 'maintenance';

export interface SlaExclusionWindow {
  /** Label for the window, e.g. "Weekly maintenance" */
  label: string;
  /** Day of week (0=Sun … 6=Sat), or -1 to match any day */
  dayOfWeek: number;
  /** Start time in seconds from midnight (UTC) */
  startSecond: number;
  /** Duration in seconds */
  durationSeconds: number;
}

export interface SlaConfig {
  merchantId: string;
  uptimeTarget: number;
  measurementInterval: number;
  subscriberContacts?: string[];
  /** Maximum credit that can be issued per measurement interval (0 = no cap). */
  creditCap?: number;
  /** Scheduled windows excluded from SLA measurement (planned maintenance). */
  exclusionWindows?: SlaExclusionWindow[];
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
