import { create } from 'zustand';
import {
  DeveloperProfile,
  ApiKey,
  ApiKeyPermission,
  ApiKeyStatus,
  UsageStats,
  UsageRecord,
  OnboardingStep,
  DocumentationSection,
  IntegrationGuide,
} from '../types/developerPortal';
import { developerPortalService } from '../services/sandbox/developerPortalService';
import { apiKeyService } from '../services/sandbox/apiKeyService';
import { usageTrackingService } from '../services/sandbox/usageTrackingService';
import { errorHandler, AppError } from '../services/errorHandler';

interface DeveloperPortalState {
  developer: DeveloperProfile | null;
  apiKeys: ApiKey[];
  usageStats: UsageStats | null;
  recentUsage: UsageRecord[];
  onboardingSteps: OnboardingStep[];
  documentation: DocumentationSection[];
  integrationGuides: IntegrationGuide[];
  isLoading: boolean;
  error: AppError | null;

  registerDeveloper: (
    email: string,
    name: string,
    company?: string,
    website?: string
  ) => Promise<void>;
  fetchDeveloper: (developerId: string) => Promise<void>;
  updateDeveloper: (updates: Partial<DeveloperProfile>) => Promise<void>;

  fetchApiKeys: (developerId: string) => Promise<void>;
  createApiKey: (
    developerId: string,
    name: string,
    permissions?: ApiKeyPermission[],
    options?: { rateLimit?: number; dailyLimit?: number; expiresAt?: Date }
  ) => Promise<ApiKey>;
  revokeApiKey: (keyId: string) => Promise<void>;
  rotateApiKey: (keyId: string) => Promise<void>;
  deleteApiKey: (keyId: string) => Promise<void>;

  fetchUsageStats: (developerId: string, period: { start: Date; end: Date }) => Promise<void>;
  fetchRecentUsage: (developerId: string, limit?: number) => Promise<void>;

  fetchOnboardingSteps: (developerId: string) => Promise<void>;
  completeOnboardingStep: (developerId: string, stepId: string) => Promise<void>;

  fetchDocumentation: () => void;
  searchDocumentation: (query: string) => void;

  fetchIntegrationGuides: () => void;
  searchIntegrationGuides: (query: string) => void;

  clearError: () => void;
}

export const useDeveloperPortalStore = create<DeveloperPortalState>()((set, get) => ({
  developer: null,
  apiKeys: [],
  usageStats: null,
  recentUsage: [],
  onboardingSteps: [],
  documentation: [],
  integrationGuides: [],
  isLoading: false,
  error: null,

  registerDeveloper: async (email, name, company, website) => {
    set({ isLoading: true, error: null });
    try {
      const developer = await developerPortalService.registerDeveloper(
        email,
        name,
        company,
        website
      );
      const steps = await developerPortalService.getOnboardingSteps(developer.id);
      set({
        developer,
        onboardingSteps: steps,
        isLoading: false,
      });
    } catch (error) {
      set({
        error: errorHandler.handleError(error as Error, {
          action: 'registerDeveloper',
        }),
        isLoading: false,
      });
    }
  },

  fetchDeveloper: async (developerId: string) => {
    set({ isLoading: true, error: null });
    try {
      await Promise.all([developerPortalService.loadDevelopers(), apiKeyService.loadApiKeys()]);

      const developer = await developerPortalService.getDeveloper(developerId);
      if (!developer) {
        throw new Error('Developer not found');
      }

      const [apiKeys, steps] = await Promise.all([
        apiKeyService.getApiKeysByDeveloper(developerId),
        developerPortalService.getOnboardingSteps(developerId),
      ]);

      set({
        developer,
        apiKeys,
        onboardingSteps: steps,
        isLoading: false,
      });
    } catch (error) {
      set({
        error: errorHandler.handleError(error as Error, {
          action: 'fetchDeveloper',
        }),
        isLoading: false,
      });
    }
  },

  updateDeveloper: async (updates) => {
    const { developer } = get();
    if (!developer) return;

    set({ isLoading: true, error: null });
    try {
      const updated = await developerPortalService.updateDeveloper(developer.id, updates);
      set({ developer: updated, isLoading: false });
    } catch (error) {
      set({
        error: errorHandler.handleError(error as Error, {
          action: 'updateDeveloper',
        }),
        isLoading: false,
      });
    }
  },

  fetchApiKeys: async (developerId: string) => {
    set({ isLoading: true, error: null });
    try {
      await apiKeyService.loadApiKeys();
      const apiKeys = await apiKeyService.getApiKeysByDeveloper(developerId);
      set({ apiKeys, isLoading: false });
    } catch (error) {
      set({
        error: errorHandler.handleError(error as Error, {
          action: 'fetchApiKeys',
        }),
        isLoading: false,
      });
    }
  },

  createApiKey: async (developerId, name, permissions, _options) => {
    set({ isLoading: true, error: null });
    try {
      const permissionStrings = permissions?.map((p) => p.toString()) || ['read', 'write'];
      const apiKey = await apiKeyService.createApiKey(
        developerId,
        name,
        undefined,
        permissionStrings
      );
      set((state) => ({
        apiKeys: [...state.apiKeys, apiKey],
        isLoading: false,
      }));

      await developerPortalService.completeOnboardingStep(developerId, 'generate-api-key');

      const steps = await developerPortalService.getOnboardingSteps(developerId);
      set({ onboardingSteps: steps });

      return apiKey;
    } catch (error) {
      const appError = errorHandler.handleError(error as Error, {
        action: 'createApiKey',
      });
      set({ error: appError, isLoading: false });
      throw appError;
    }
  },

  revokeApiKey: async (keyId: string) => {
    set({ isLoading: true, error: null });
    try {
      await apiKeyService.revokeApiKey(keyId);
      set((state) => ({
        apiKeys: state.apiKeys.map((k) =>
          k.id === keyId ? { ...k, status: ApiKeyStatus.REVOKED } : k
        ),
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: errorHandler.handleError(error as Error, {
          action: 'revokeApiKey',
        }),
        isLoading: false,
      });
    }
  },

  rotateApiKey: async (keyId: string) => {
    set({ isLoading: true, error: null });
    try {
      const rotated = await apiKeyService.rotateApiKey(keyId);
      if (rotated) {
        set((state) => ({
          apiKeys: state.apiKeys.map((k) => (k.id === keyId ? rotated : k)),
          isLoading: false,
        }));
      }
    } catch (error) {
      set({
        error: errorHandler.handleError(error as Error, {
          action: 'rotateApiKey',
        }),
        isLoading: false,
      });
    }
  },

  deleteApiKey: async (keyId: string) => {
    set({ isLoading: true, error: null });
    try {
      await apiKeyService.deleteApiKey(keyId);
      set((state) => ({
        apiKeys: state.apiKeys.filter((k) => k.id !== keyId),
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: errorHandler.handleError(error as Error, {
          action: 'deleteApiKey',
        }),
        isLoading: false,
      });
    }
  },

  fetchUsageStats: async (developerId, _period) => {
    set({ isLoading: true, error: null });
    try {
      await usageTrackingService.loadUsage(developerId);
      const usageStats = await usageTrackingService.getUsageStats(developerId);
      set({ usageStats, isLoading: false });
    } catch (error) {
      set({
        error: errorHandler.handleError(error as Error, {
          action: 'fetchUsageStats',
        }),
        isLoading: false,
      });
    }
  },

  fetchRecentUsage: async (developerId, limit) => {
    set({ isLoading: true, error: null });
    try {
      const recentUsage = await usageTrackingService.getRecentMetrics(developerId, limit);
      set({ recentUsage, isLoading: false });
    } catch (error) {
      set({
        error: errorHandler.handleError(error as Error, {
          action: 'fetchRecentUsage',
        }),
        isLoading: false,
      });
    }
  },

  fetchOnboardingSteps: async (developerId: string) => {
    try {
      const steps = await developerPortalService.getOnboardingSteps(developerId);
      set({ onboardingSteps: steps });
    } catch (error) {
      console.error('Failed to fetch onboarding steps:', error);
    }
  },

  completeOnboardingStep: async (developerId, stepId) => {
    try {
      const steps = await developerPortalService.completeOnboardingStep(developerId, stepId);
      if (steps) {
        set({ onboardingSteps: steps });
      }
    } catch (error) {
      console.error('Failed to complete onboarding step:', error);
    }
  },

  fetchDocumentation: () => {
    const documentation = developerPortalService.getDocumentationSections();
    set({ documentation });
  },

  searchDocumentation: (query) => {
    const documentation = developerPortalService.searchDocumentation(query);
    set({ documentation });
  },

  fetchIntegrationGuides: () => {
    const integrationGuides = developerPortalService.getIntegrationGuides();
    set({ integrationGuides });
  },

  searchIntegrationGuides: (query) => {
    const integrationGuides = developerPortalService.searchIntegrationGuides(query);
    set({ integrationGuides });
  },

  clearError: () => set({ error: null }),
}));
