import { create } from 'zustand';
import type {
  PaymentFailure,
  PaymentFailureNotification,
  PaymentRetryStrategy,
  PaymentFailureAnalytics,
  PaymentFailureHistory,
  FailureNotificationPreferences,
  SmartRetryConfig,
  FailureNotificationRequest,
  FailureNotificationResponse,
} from '../types/paymentFailure';
import * as paymentFailureService from '../services/paymentFailureService';

interface PaymentFailureState {
  failures: PaymentFailure[];
  notifications: PaymentFailureNotification[];
  retries: PaymentRetryStrategy[];
  analytics: PaymentFailureAnalytics | null;
  selectedFailure: PaymentFailure | null;
  preferences: FailureNotificationPreferences | null;
  retryConfig: SmartRetryConfig | null;
  loading: boolean;
  error: string | null;

  // Actions
  loadFailures: (userId?: string) => Promise<void>;
  loadUnresolvedFailures: (userId: string) => Promise<void>;
  loadFailureById: (id: string) => Promise<void>;
  recordFailure: (failure: Omit<PaymentFailure, 'id' | 'failedAt'>) => Promise<PaymentFailure>;
  resolveFailure: (failureId: string, resolutionMethod: import('../types/paymentFailure').ResolutionMethod) => Promise<void>;
  
  loadNotifications: (failureId?: string, userId?: string) => Promise<void>;
  sendNotification: (request: FailureNotificationRequest) => Promise<FailureNotificationResponse>;
  markNotificationRead: (notificationId: string) => Promise<void>;
  markNotificationClicked: (notificationId: string) => Promise<void>;
  
  loadRetries: (failureId?: string) => Promise<void>;
  scheduleRetry: (failure: PaymentFailure) => Promise<void>;
  executeRetry: (retryId: string) => Promise<void>;
  
  loadAnalytics: (userId?: string) => Promise<void>;
  loadHistory: (userId: string, page?: number, pageSize?: number) => Promise<PaymentFailureHistory>;
  
  loadPreferences: (userId: string) => Promise<void>;
  updatePreferences: (preferences: FailureNotificationPreferences) => Promise<void>;
  
  loadRetryConfig: () => Promise<void>;
  updateRetryConfig: (config: SmartRetryConfig) => Promise<void>;
  
  setSelectedFailure: (failure: PaymentFailure | null) => void;
  clearError: () => void;
}

export const usePaymentFailureStore = create<PaymentFailureState>((set, get) => ({
  failures: [],
  notifications: [],
  retries: [],
  analytics: null,
  selectedFailure: null,
  preferences: null,
  retryConfig: null,
  loading: false,
  error: null,

  // Failure management
  loadFailures: async (userId?: string) => {
    set({ loading: true, error: null });
    try {
      const failures = await paymentFailureService.getAllFailures(userId);
      set({ failures, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load payment failures';
      set({ loading: false, error: message });
    }
  },

  loadUnresolvedFailures: async (userId: string) => {
    set({ loading: true, error: null });
    try {
      const failures = await paymentFailureService.getUnresolvedFailures(userId);
      set({ failures, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load unresolved failures';
      set({ loading: false, error: message });
    }
  },

  loadFailureById: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const failure = await paymentFailureService.getFailureById(id);
      set({ selectedFailure: failure, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load failure';
      set({ loading: false, error: message });
    }
  },

  recordFailure: async (failure: Omit<PaymentFailure, 'id' | 'failedAt'>) => {
    set({ loading: true, error: null });
    try {
      const newFailure = await paymentFailureService.recordPaymentFailure(failure);
      
      // Reload failures and notifications
      await get().loadFailures(failure.userId);
      await get().loadNotifications(newFailure.id);
      
      set({ loading: false, selectedFailure: newFailure });
      return newFailure;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to record failure';
      set({ loading: false, error: message });
      throw error;
    }
  },

  resolveFailure: async (failureId: string, resolutionMethod) => {
    set({ loading: true, error: null });
    try {
      const resolved = await paymentFailureService.resolveFailure(failureId, resolutionMethod);
      
      // Update local state
      const failures = get().failures.map(f => (f.id === failureId ? resolved : f));
      set({ failures, selectedFailure: resolved, loading: false });
      
      // Reload analytics
      if (resolved.userId) {
        await get().loadAnalytics(resolved.userId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resolve failure';
      set({ loading: false, error: message });
    }
  },

  // Notification management
  loadNotifications: async (failureId?: string, userId?: string) => {
    set({ loading: true, error: null });
    try {
      const notifications = await paymentFailureService.getAllNotifications(failureId, userId);
      set({ notifications, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load notifications';
      set({ loading: false, error: message });
    }
  },

  sendNotification: async (request: FailureNotificationRequest) => {
    set({ loading: true, error: null });
    try {
      const response = await paymentFailureService.sendFailureNotification(request);
      
      // Reload notifications
      await get().loadNotifications(request.failureId);
      
      set({ loading: false });
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send notification';
      set({ loading: false, error: message });
      throw error;
    }
  },

  markNotificationRead: async (notificationId: string) => {
    try {
      await paymentFailureService.markNotificationAsRead(notificationId);
      
      // Update local state
      const notifications = get().notifications.map(n =>
        n.id === notificationId ? { ...n, readAt: new Date() } : n
      );
      set({ notifications });
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  },

  markNotificationClicked: async (notificationId: string) => {
    try {
      await paymentFailureService.markNotificationAsClicked(notificationId);
      
      // Update local state
      const notifications = get().notifications.map(n =>
        n.id === notificationId ? { ...n, clickedAt: new Date() } : n
      );
      set({ notifications });
    } catch (error) {
      console.error('Failed to mark notification as clicked:', error);
    }
  },

  // Retry management
  loadRetries: async (failureId?: string) => {
    set({ loading: true, error: null });
    try {
      const retries = await paymentFailureService.getAllRetries(failureId);
      set({ retries, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load retries';
      set({ loading: false, error: message });
    }
  },

  scheduleRetry: async (failure: PaymentFailure) => {
    set({ loading: true, error: null });
    try {
      await paymentFailureService.scheduleRetry(failure);
      
      // Reload retries
      await get().loadRetries(failure.id);
      
      set({ loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to schedule retry';
      set({ loading: false, error: message });
    }
  },

  executeRetry: async (retryId: string) => {
    set({ loading: true, error: null });
    try {
      const retry = await paymentFailureService.executeRetry(retryId);
      
      // Reload retries and failures
      await get().loadRetries(retry.failureId);
      const failure = await paymentFailureService.getFailureById(retry.failureId);
      if (failure?.userId) {
        await get().loadFailures(failure.userId);
      }
      
      set({ loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to execute retry';
      set({ loading: false, error: message });
    }
  },

  // Analytics
  loadAnalytics: async (userId?: string) => {
    set({ loading: true, error: null });
    try {
      const analytics = await paymentFailureService.getPaymentFailureAnalytics(userId);
      set({ analytics, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load analytics';
      set({ loading: false, error: message });
    }
  },

  loadHistory: async (userId: string, page = 1, pageSize = 20) => {
    set({ loading: true, error: null });
    try {
      const history = await paymentFailureService.getPaymentFailureHistory(userId, page, pageSize);
      set({ 
        failures: history.failures,
        notifications: history.notifications,
        retries: history.retries,
        loading: false 
      });
      return history;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load history';
      set({ loading: false, error: message });
      throw error;
    }
  },

  // Preferences
  loadPreferences: async (userId: string) => {
    set({ loading: true, error: null });
    try {
      const preferences = await paymentFailureService.getNotificationPreferences(userId);
      set({ preferences, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load preferences';
      set({ loading: false, error: message });
    }
  },

  updatePreferences: async (preferences: FailureNotificationPreferences) => {
    set({ loading: true, error: null });
    try {
      await paymentFailureService.updateNotificationPreferences(preferences);
      set({ preferences, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update preferences';
      set({ loading: false, error: message });
    }
  },

  // Retry config
  loadRetryConfig: async () => {
    set({ loading: true, error: null });
    try {
      const retryConfig = await paymentFailureService.getSmartRetryConfig();
      set({ retryConfig, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load retry config';
      set({ loading: false, error: message });
    }
  },

  updateRetryConfig: async (config: SmartRetryConfig) => {
    set({ loading: true, error: null });
    try {
      await paymentFailureService.updateSmartRetryConfig(config);
      set({ retryConfig: config, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update retry config';
      set({ loading: false, error: message });
    }
  },

  // Utility
  setSelectedFailure: (failure: PaymentFailure | null) => {
    set({ selectedFailure: failure });
  },

  clearError: () => set({ error: null }),
}));
