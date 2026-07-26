import { create } from 'zustand';
import type {
  FraudDetection,
  FraudAlert,
  FraudAnalytics,
  FraudInvestigation,
  FraudCheckRequest,
  FraudCheckResponse,
  FraudReport,
  FraudFilters,
  FraudStatus,
  RealTimeMonitoring,
} from '../types/fraud';
import * as fraudService from '../services/fraudDetectionService';

interface FraudStore {
  detections: FraudDetection[];
  alerts: FraudAlert[];
  analytics: FraudAnalytics | null;
  investigations: FraudInvestigation[];
  monitoring: RealTimeMonitoring | null;
  isLoading: boolean;
  error: string | null;

  // Detection operations
  performFraudCheck: (request: FraudCheckRequest) => Promise<FraudCheckResponse>;
  loadDetections: (filters?: FraudFilters) => Promise<void>;
  updateDetectionStatus: (id: string, status: FraudStatus, reviewedBy?: string, notes?: string) => Promise<void>;
  getDetectionById: (id: string) => FraudDetection | undefined;

  // Alert operations
  loadAlerts: () => Promise<void>;
  markAlertAsRead: (id: string) => Promise<void>;
  resolveAlert: (id: string, actionTaken: string) => Promise<void>;
  getUnreadAlerts: () => FraudAlert[];

  // Analytics
  loadAnalytics: () => Promise<void>;

  // Investigation
  createInvestigation: (detectionId: string, investigator: string, priority: 'low' | 'medium' | 'high' | 'urgent') => Promise<FraudInvestigation>;
  updateInvestigation: (id: string, updates: Partial<FraudInvestigation>) => Promise<void>;
  loadInvestigations: () => Promise<void>;

  // Reporting
  generateReport: (reportType: 'daily' | 'weekly' | 'monthly' | 'custom', period: { start: Date; end: Date }) => Promise<FraudReport>;

  // Monitoring
  loadMonitoring: () => Promise<void>;

  // Utility
  clearError: () => void;
  reset: () => void;
}

const initialState = {
  detections: [],
  alerts: [],
  analytics: null,
  investigations: [],
  monitoring: null,
  isLoading: false,
  error: null,
};

export const useFraudStore = create<FraudStore>((set, get) => ({
  ...initialState,

  performFraudCheck: async (request: FraudCheckRequest) => {
    set({ isLoading: true, error: null });
    try {
      const response = await fraudService.performFraudCheck(request);
      
      // Reload detections to include new one
      await get().loadDetections();
      
      // Reload alerts if high risk
      if (response.riskScore >= 50) {
        await get().loadAlerts();
      }
      
      set({ isLoading: false });
      return response;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  loadDetections: async (filters?: FraudFilters) => {
    set({ isLoading: true, error: null });
    try {
      const detections = await fraudService.getAllDetections(filters);
      set({ detections, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  updateDetectionStatus: async (id: string, status: FraudStatus, reviewedBy?: string, notes?: string) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await fraudService.updateDetectionStatus(id, status, reviewedBy, notes);
      set(state => ({
        detections: state.detections.map(d => d.id === id ? updated : d),
        isLoading: false,
      }));
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  getDetectionById: (id: string) => {
    return get().detections.find(d => d.id === id);
  },

  loadAlerts: async () => {
    set({ isLoading: true, error: null });
    try {
      const alerts = await fraudService.getAllAlerts();
      set({ alerts, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  markAlertAsRead: async (id: string) => {
    try {
      await fraudService.markAlertAsRead(id);
      set(state => ({
        alerts: state.alerts.map(a => a.id === id ? { ...a, isRead: true } : a),
      }));
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  resolveAlert: async (id: string, actionTaken: string) => {
    try {
      await fraudService.resolveAlert(id, actionTaken);
      set(state => ({
        alerts: state.alerts.map(a =>
          a.id === id ? { ...a, isResolved: true, actionTaken, resolvedAt: new Date() } : a
        ),
      }));
    } catch (error) {
      set({ error: (error as Error).message });
      throw error;
    }
  },

  getUnreadAlerts: () => {
    return get().alerts.filter(a => !a.isRead);
  },

  loadAnalytics: async () => {
    set({ isLoading: true, error: null });
    try {
      const analytics = await fraudService.getFraudAnalytics();
      set({ analytics, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  createInvestigation: async (detectionId: string, investigator: string, priority: 'low' | 'medium' | 'high' | 'urgent') => {
    set({ isLoading: true, error: null });
    try {
      const investigation = await fraudService.createInvestigation(detectionId, investigator, priority);
      set(state => ({
        investigations: [...state.investigations, investigation],
        isLoading: false,
      }));
      return investigation;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  updateInvestigation: async (id: string, updates: Partial<FraudInvestigation>) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await fraudService.updateInvestigation(id, updates);
      set(state => ({
        investigations: state.investigations.map(i => i.id === id ? updated : i),
        isLoading: false,
      }));
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  loadInvestigations: async () => {
    set({ isLoading: true, error: null });
    try {
      const investigations = await fraudService.getAllInvestigations();
      set({ investigations, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  generateReport: async (reportType: 'daily' | 'weekly' | 'monthly' | 'custom', period: { start: Date; end: Date }) => {
    set({ isLoading: true, error: null });
    try {
      const report = await fraudService.generateFraudReport(reportType, period);
      set({ isLoading: false });
      return report;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  loadMonitoring: async () => {
    set({ isLoading: true, error: null });
    try {
      const monitoring = await fraudService.getMonitoringStatus();
      set({ monitoring, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  clearError: () => set({ error: null }),
  reset: () => set(initialState),
}));
