import { create } from 'zustand';
import type {
  SLADefinition,
  SLATracking,
  SLABreach,
  SLAAlert,
  SLAAnalytics,
  SLAReport,
  SLACheckRequest,
  SLACheckResponse,
  SLAFilters,
  SLATier,
  SLADashboard,
  SLACreditIssuance,
  SLAPeriod,
} from '../types/sla';
import * as slaService from '../services/slaService';

interface SLAStore {
  definitions: SLADefinition[];
  trackings: SLATracking[];
  breaches: SLABreach[];
  alerts: SLAAlert[];
  analytics: SLAAnalytics | null;
  dashboard: SLADashboard | null;
  credits: SLACreditIssuance[];
  isLoading: boolean;
  error: string | null;

  // SLA Check
  performSLACheck: (request: SLACheckRequest) => Promise<SLACheckResponse>;

  // Definitions
  loadDefinitions: (tier?: SLATier) => Promise<void>;
  createDefinition: (data: Omit<SLADefinition, 'id' | 'createdAt' | 'updatedAt'>) => Promise<SLADefinition>;

  // Tracking
  loadTrackings: (filters?: SLAFilters) => Promise<void>;

  // Breaches
  loadBreaches: (filters?: { status?: string; subscriptionId?: string }) => Promise<void>;
  updateBreachStatus: (id: string, status: string, notes?: string) => Promise<void>;

  // Alerts
  loadAlerts: () => Promise<void>;
  markAlertAsRead: (id: string) => Promise<void>;
  resolveAlert: (id: string) => Promise<void>;
  getUnreadAlerts: () => SLAAlert[];

  // Analytics
  loadAnalytics: () => Promise<void>;

  // Dashboard
  loadDashboard: () => Promise<void>;

  // Reporting
  generateReport: (reportType: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom', period: SLAPeriod, tier?: SLATier) => Promise<SLAReport>;

  // Credits
  loadCredits: () => Promise<void>;
  approveCredit: (id: string) => Promise<void>;

  // Utility
  clearError: () => void;
  reset: () => void;
}

const initialState = {
  definitions: [],
  trackings: [],
  breaches: [],
  alerts: [],
  analytics: null,
  dashboard: null,
  credits: [],
  isLoading: false,
  error: null,
};

export const useSLAStore = create<SLAStore>((set, get) => ({
  ...initialState,

  performSLACheck: async (request: SLACheckRequest) => {
    set({ isLoading: true, error: null });
    try {
      const response = await slaService.performSLACheck(request);
      
      // Reload relevant data
      await get().loadTrackings();
      if (response.breached) {
        await get().loadBreaches();
        await get().loadAlerts();
      }
      
      set({ isLoading: false });
      return response;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  loadDefinitions: async (tier?: SLATier) => {
    set({ isLoading: true, error: null });
    try {
      const definitions = await slaService.getAllSLADefinitions(tier);
      set({ definitions, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  createDefinition: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const definition = await slaService.createSLADefinition(data);
      set(state => ({
        definitions: [...state.definitions, definition],
        isLoading: false,
      }));
      return definition;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  loadTrackings: async (filters?: SLAFilters) => {
    set({ isLoading: true, error: null });
    try {
      const trackings = await slaService.getAllTrackings(filters);
      set({ trackings, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  loadBreaches: async (filters?) => {
    set({ isLoading: true, error: null });
    try {
      const breaches = await slaService.getAllBreaches(filters);
      set({ breaches, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  updateBreachStatus: async (id: string, status: string, notes?: string) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await slaService.updateBreachStatus(id, status, notes);
      set(state => ({
        breaches: state.breaches.map(b => b.id === id ? updated : b),
        isLoading: false,
      }));
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  loadAlerts: async () => {
    set({ isLoading: true, error: null });
    try {
      const alerts = await slaService.getAllAlerts();
      set({ alerts, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  markAlertAsRead: async (id: string) => {
    try {
      await slaService.markAlertAsRead(id);
      set(state => ({
        alerts: state.alerts.map(a => a.id === id ? { ...a, isRead: true, acknowledgedAt: new Date() } : a),
      }));
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  resolveAlert: async (id: string) => {
    try {
      await slaService.resolveAlert(id);
      set(state => ({
        alerts: state.alerts.map(a => a.id === id ? { ...a, isResolved: true, resolvedAt: new Date() } : a),
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
      const analytics = await slaService.getSLAAnalytics();
      set({ analytics, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  loadDashboard: async () => {
    set({ isLoading: true, error: null });
    try {
      const dashboard = await slaService.getSLADashboard();
      set({ dashboard, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  generateReport: async (reportType, period, tier?) => {
    set({ isLoading: true, error: null });
    try {
      const report = await slaService.generateSLAReport(reportType, period, tier);
      set({ isLoading: false });
      return report;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  loadCredits: async () => {
    set({ isLoading: true, error: null });
    try {
      const credits = await slaService.getAllCredits();
      set({ credits, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  approveCredit: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const approved = await slaService.approveCreditIssuance(id);
      set(state => ({
        credits: state.credits.map(c => c.id === id ? approved : c),
        isLoading: false,
      }));
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  clearError: () => set({ error: null }),
  reset: () => set(initialState),
}));
