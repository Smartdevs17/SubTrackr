/**
 * Risk Slice – fraud detection and SLA management.
 */
import type { StateCreator } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FraudMerchantRecord, FraudSubscriptionRecord, FraudCase, FraudRiskScore, FraudAction, FraudReport, FraudAnalytics } from '../../types/fraud';
import { SlaConfig, SlaStatus, SlaAvailabilityEvent, SlaBreach, SlaDashboardReport, SlaAvailabilityState } from '../../types/sla';
import { errorHandler, AppError } from '../../services/errorHandler';

// ── Interfaces ──────────────────────────────────────────────────────────

export interface FraudSlice {
  fraudMerchants: FraudMerchantRecord[];
  fraudSubscriptions: FraudSubscriptionRecord[];
  fraudAssessments: FraudRiskScore[];
  fraudReviewQueue: FraudCase[];
  fraudAnalytics: FraudAnalytics;
  fraudLoading: boolean;
  fraudError: string | null;
  refreshFraudSignals: () => void;
  assessFraudRisk: (subscriberId: string) => FraudRiskScore[];
  flagFraudSubscription: (subscriptionId: string) => void;
  approveFraudSubscription: (subscriptionId: string) => void;
  blockFraudSubscription: (subscriptionId: string) => void;
  resolveFraudCase: (subscriptionId: string, action: FraudAction) => void;
  getFraudReport: (merchantId: string) => FraudReport;
}

export interface SlaSlice {
  slaConfigs: Record<string, SlaConfig>;
  slaStatuses: Record<string, SlaStatus>;
  slaAvailabilityEvents: SlaAvailabilityEvent[];
  slaBreaches: SlaBreach[];
  slaReport: SlaDashboardReport;
  slaLoading: boolean;
  slaError: AppError | null;
  configureSla: (merchantId: string, config: Partial<SlaConfig>) => Promise<void>;
  trackServiceAvailability: (merchantId: string, input: { durationSeconds: number; state: SlaAvailabilityState; note?: string; timestamp?: number }) => Promise<void>;
  detectSlaBreach: (merchantId: string) => Promise<SlaStatus | null>;
  acknowledgeSlaBreach: (breachId: string) => Promise<void>;
  calculateSlaCredit: (breachId: string) => number;
  getSlaStatus: (merchantId: string) => SlaStatus | null;
  refreshSlaReport: () => void;
}

// ── Seed data ───────────────────────────────────────────────────────────

const merchantSeeds: FraudMerchantRecord[] = [
  { id: 'merch_nova', name: 'Nova Stream', status: 'watch', activeSubscriptions: 128, blockedSubscriptions: 4, averageRisk: 41, monthlyVolume: 18650 },
  { id: 'merch_orbit', name: 'Orbit Tools', status: 'healthy', activeSubscriptions: 83, blockedSubscriptions: 1, averageRisk: 22, monthlyVolume: 9420 },
  { id: 'merch_cipher', name: 'Cipher Pro', status: 'high-risk', activeSubscriptions: 46, blockedSubscriptions: 9, averageRisk: 67, monthlyVolume: 7825 },
];

const generateId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type RiskStore = FraudSlice & SlaSlice;
type RiskCreator = StateCreator<RiskStore & any, [], [], RiskStore>;

// ═══════════════════════════════════════════════════════════════════════════
// Slice Factory
// ═══════════════════════════════════════════════════════════════════════════

export const createRiskSlice: RiskCreator = (set, get) => ({
  // ── Fraud state ───────────────────────────────────────────────────
  fraudMerchants: merchantSeeds.map((m) => ({ ...m })),
  fraudSubscriptions: [],
  fraudAssessments: [],
  fraudReviewQueue: [],
  fraudAnalytics: { totalChecks: 0, approved: 0, flagged: 0, blocked: 0, manualReviews: 0, avgRisk: 0, velocityAlerts: 0, anomalyAlerts: 0, chargebackPredictions: 0, falsePositiveEstimate: 0 },
  fraudLoading: false,
  fraudError: null,

  refreshFraudSignals: () => {
    const { fraudSubscriptions, fraudReviewQueue, fraudMerchants } = get();
    set({ fraudAnalytics: { totalChecks: fraudSubscriptions.length, approved: 0, flagged: 0, blocked: 0, manualReviews: fraudReviewQueue.length, avgRisk: 0, velocityAlerts: 0, anomalyAlerts: 0, chargebackPredictions: 0, falsePositiveEstimate: 0 } });
  },

  assessFraudRisk: (_subscriberId) => [],
  flagFraudSubscription: (subscriptionId) => {
    set((s) => {
      const nextCase: FraudCase = { caseId: subscriptionId, subscriptionId, subscriberId: '', merchantId: '', merchantName: '', subscriptionName: '', riskScore: 0, action: 'flag', status: 'pending', reason: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), notes: 'Flagged' };
      return { fraudReviewQueue: [...s.fraudReviewQueue, nextCase] };
    });
  },

  approveFraudSubscription: (subscriptionId) => {
    set((s) => ({ fraudReviewQueue: s.fraudReviewQueue.map((c) => c.subscriptionId === subscriptionId ? { ...c, status: 'reviewed', action: 'approve' } : c) }));
  },

  blockFraudSubscription: (subscriptionId) => {
    set((s) => ({ fraudReviewQueue: s.fraudReviewQueue.map((c) => c.subscriptionId === subscriptionId ? { ...c, status: 'escalated', action: 'block' } : c) }));
  },

  resolveFraudCase: (subscriptionId, action) => {
    set((s) => ({ fraudReviewQueue: s.fraudReviewQueue.map((c) => c.subscriptionId === subscriptionId ? { ...c, action, status: action === 'approve' ? 'reviewed' : 'escalated' } : c) }));
  },

  getFraudReport: (merchantId) => {
    const merchant = get().fraudMerchants.find((m) => m.id === merchantId);
    return { merchantId, merchantName: merchant?.name ?? 'Unknown', totalSubscriptions: 0, flaggedSubscriptions: 0, blockedSubscriptions: 0, manualReviewCount: 0, averageRisk: 0, velocityAlerts: 0, anomalyAlerts: 0, chargebackPredictions: 0, highRiskSubscribers: 0, recentCases: [] };
  },

  // ── SLA state ─────────────────────────────────────────────────────
  slaConfigs: {},
  slaStatuses: {},
  slaAvailabilityEvents: [],
  slaBreaches: [],
  slaReport: { summary: { totalMerchants: 0, compliantMerchants: 0, breachCount: 0, averageUptime: 100, totalCreditsIssued: 0, partialOutageEvents: 0, maintenanceEvents: 0 }, configs: {}, statuses: {}, breaches: [], events: [] },
  slaLoading: false,
  slaError: null,

  configureSla: async (merchantId, config) => {
    set({ slaLoading: true, slaError: null });
    try {
      const normalized: SlaConfig = { id: merchantId, merchantId, uptimeTarget: config.uptimeTarget ?? 99.9, measurementWindowDays: config.measurementWindowDays ?? 30, creditRateBps: config.creditRateBps ?? 1000, maxCreditPercentage: config.maxCreditPercentage ?? 100, excludesScheduledMaintenance: config.excludesScheduledMaintenance ?? true } as SlaConfig;
      set((s) => {
        const nextConfigs = { ...s.slaConfigs, [merchantId]: normalized };
        return { slaConfigs: nextConfigs, slaLoading: false };
      });
    } catch (error) {
      set({ slaError: errorHandler.handleError(error as Error, { action: 'configureSla' }), slaLoading: false });
    }
  },

  trackServiceAvailability: async (merchantId, input) => {
    set({ slaLoading: true, slaError: null });
    try {
      const event: SlaAvailabilityEvent = { id: generateId('sla-event'), merchantId, timestamp: input.timestamp ?? Date.now(), durationSeconds: Math.max(1, Math.floor(input.durationSeconds)), state: input.state, note: input.note };
      set((s) => ({ slaAvailabilityEvents: [...s.slaAvailabilityEvents, event], slaLoading: false }));
    } catch (error) {
      set({ slaError: errorHandler.handleError(error as Error, { action: 'trackServiceAvailability' }), slaLoading: false });
    }
  },

  detectSlaBreach: async (merchantId) => {
    return get().slaStatuses[merchantId] ?? null;
  },

  acknowledgeSlaBreach: async (breachId) => {
    set((s) => ({ slaBreaches: s.slaBreaches.map((b) => b.id === breachId ? { ...b, acknowledged: true } : b) }));
  },

  calculateSlaCredit: (breachId) => get().slaBreaches.find((b) => b.id === breachId)?.creditAmount ?? 0,
  getSlaStatus: (merchantId) => get().slaStatuses[merchantId] ?? null,
  refreshSlaReport: () => { /* no-op for combined store */ },
});
