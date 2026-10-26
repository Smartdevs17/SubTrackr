import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { act } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDeveloperPortalStore } from '../developerPortalStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../services/sandbox/apiKeyService', () => ({
  apiKeyService: {
    loadApiKeys: jest.fn(() => Promise.resolve()),
    getApiKeysByDeveloper: jest.fn(() => Promise.resolve([])),
    createApiKey: jest.fn(() =>
      Promise.resolve({
        id: 'key-1',
        key: 'sk_test_abc',
        name: 'Test Key',
        status: 'active',
        permissions: ['read', 'write'],
        createdAt: new Date(),
      })
    ),
    revokeApiKey: jest.fn(() => Promise.resolve()),
    rotateApiKey: jest.fn(() => Promise.resolve(null)),
    deleteApiKey: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('../../services/sandbox/usageTrackingService', () => ({
  usageTrackingService: {
    loadUsage: jest.fn(() => Promise.resolve()),
    getUsageStats: jest.fn(() =>
      Promise.resolve({
        totalRequests: 10,
        successfulRequests: 8,
        failedRequests: 2,
        avgResponseTime: 120,
      })
    ),
    getRecentMetrics: jest.fn(() => Promise.resolve([])),
  },
}));

jest.mock('../../services/sandbox/developerPortalService', () => ({
  developerPortalService: {
    registerDeveloper: jest.fn((email, name) =>
      Promise.resolve({
        id: 'dev-1',
        email,
        name,
        status: 'active',
        tier: 'free',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLoginAt: new Date(),
      })
    ),
    getDeveloper: jest.fn(() =>
      Promise.resolve({
        id: 'dev-1',
        email: 'test@example.com',
        name: 'Test',
        status: 'active',
        tier: 'free',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLoginAt: new Date(),
      })
    ),
    updateDeveloper: jest.fn((_id, updates) =>
      Promise.resolve({
        id: 'dev-1',
        email: 'test@example.com',
        name: 'Updated',
        status: 'active',
        tier: 'free',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLoginAt: new Date(),
        ...updates,
      })
    ),
    getOnboardingSteps: jest.fn(() =>
      Promise.resolve([
        { id: 'step-1', title: 'Step 1', isCompleted: false, isRequired: true, order: 1 },
        { id: 'step-2', title: 'Step 2', isCompleted: false, isRequired: true, order: 2 },
      ])
    ),
    completeOnboardingStep: jest.fn(() =>
      Promise.resolve([
        { id: 'step-1', title: 'Step 1', isCompleted: true, isRequired: true, order: 1 },
        { id: 'step-2', title: 'Step 2', isCompleted: false, isRequired: true, order: 2 },
      ])
    ),
    getDocumentationSections: jest.fn(() => [
      { id: 'doc-1', title: 'Getting Started', category: 'Basics', tags: [], content: '' },
    ]),
    searchDocumentation: jest.fn(() => []),
    getIntegrationGuides: jest.fn(() => [
      { id: 'guide-1', title: 'Node.js', difficulty: 'beginner', tags: [] },
    ]),
    searchIntegrationGuides: jest.fn(() => []),
  },
}));

jest.mock('../../services/errorHandler', () => ({
  errorHandler: {
    handleError: jest.fn((error) => ({
      id: 'err-1',
      type: 'unknown',
      severity: 'medium',
      message: error instanceof Error ? error.message : 'Unknown error',
      userMessage: 'Something went wrong',
      recoverySuggestions: [],
      context: { action: 'test' },
      isHandled: false,
    })),
  },
  AppError: {},
}));

describe('useDeveloperPortalStore', () => {
  beforeEach(() => {
    useDeveloperPortalStore.setState({
      developer: null,
      apiKeys: [],
      usageStats: null,
      recentUsage: [],
      onboardingSteps: [],
      documentation: [],
      integrationGuides: [],
      isLoading: false,
      error: null,
    });
  });

  it('starts with empty state', () => {
    const state = useDeveloperPortalStore.getState();
    expect(state.developer).toBeNull();
    expect(state.apiKeys).toHaveLength(0);
    expect(state.isLoading).toBe(false);
  });

  it('registers a developer', async () => {
    await act(async () => {
      await useDeveloperPortalStore.getState().registerDeveloper('test@example.com', 'Test');
    });

    const state = useDeveloperPortalStore.getState();
    expect(state.developer?.email).toBe('test@example.com');
    expect(state.developer?.name).toBe('Test');
    expect(state.isLoading).toBe(false);
  });

  it('fetches developer and api keys', async () => {
    await act(async () => {
      await useDeveloperPortalStore.getState().fetchDeveloper('dev-1');
    });

    const state = useDeveloperPortalStore.getState();
    expect(state.developer?.id).toBe('dev-1');
    expect(state.apiKeys).toHaveLength(0);
    expect(state.onboardingSteps).toHaveLength(2);
  });

  it('updates developer', async () => {
    await act(async () => {
      await useDeveloperPortalStore.getState().fetchDeveloper('dev-1');
    });

    await act(async () => {
      await useDeveloperPortalStore.getState().updateDeveloper({ name: 'Updated' });
    });

    const state = useDeveloperPortalStore.getState();
    expect(state.developer?.name).toBe('Updated');
  });

  it('creates an api key', async () => {
    await act(async () => {
      await useDeveloperPortalStore.getState().createApiKey('dev-1', 'New Key', ['read']);
    });

    const state = useDeveloperPortalStore.getState();
    expect(state.apiKeys).toHaveLength(1);
    expect(state.apiKeys[0].name).toBe('New Key');
  });

  it('revokes an api key', async () => {
    await act(async () => {
      await useDeveloperPortalStore.getState().createApiKey('dev-1', 'Key');
      await useDeveloperPortalStore.getState().revokeApiKey('key-1');
    });

    const state = useDeveloperPortalStore.getState();
    expect(state.apiKeys[0].status).toBe('revoked');
  });

  it('deletes an api key', async () => {
    await act(async () => {
      await useDeveloperPortalStore.getState().createApiKey('dev-1', 'Key');
      await useDeveloperPortalStore.getState().deleteApiKey('key-1');
    });

    const state = useDeveloperPortalStore.getState();
    expect(state.apiKeys).toHaveLength(0);
  });

  it('fetches usage stats', async () => {
    await act(async () => {
      await useDeveloperPortalStore.getState().fetchUsageStats('dev-1', {
        start: new Date(),
        end: new Date(),
      });
    });

    const state = useDeveloperPortalStore.getState();
    expect(state.usageStats?.totalRequests).toBe(10);
  });

  it('fetches documentation', () => {
    useDeveloperPortalStore.getState().fetchDocumentation();
    const state = useDeveloperPortalStore.getState();
    expect(state.documentation).toHaveLength(1);
  });

  it('searches documentation', () => {
    useDeveloperPortalStore.getState().searchDocumentation('query');
    const state = useDeveloperPortalStore.getState();
    expect(state.documentation).toEqual([]);
  });

  it('clears error', async () => {
    useDeveloperPortalStore.setState({
      error: {
        id: 'err-1',
        type: 'unknown',
        severity: 'medium',
        message: 'test',
        userMessage: 'test',
        recoverySuggestions: [],
        context: { action: 'test' },
        isHandled: false,
      } as any,
    });

    useDeveloperPortalStore.getState().clearError();
    const state = useDeveloperPortalStore.getState();
    expect(state.error).toBeNull();
  });
});
