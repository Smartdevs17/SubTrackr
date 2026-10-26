import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeveloperProfile, DeveloperOnboardingStep, SandboxEnvironment } from '../../types/sandbox';
import { sandboxService } from './sandboxService';
import { apiKeyService } from './apiKeyService';

const DEVELOPER_STORAGE_KEY = '@subtrackr_developer_profile';

const generateId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
};

const ONBOARDING_STEP_ORDER: DeveloperOnboardingStep[] = [
  DeveloperOnboardingStep.WELCOME,
  DeveloperOnboardingStep.CREATE_ACCOUNT,
  DeveloperOnboardingStep.GENERATE_API_KEY,
  DeveloperOnboardingStep.EXPLORE_SANDBOX,
  DeveloperOnboardingStep.BUILD_INTEGRATION,
  DeveloperOnboardingStep.GO_LIVE,
];

const STEP_DESCRIPTIONS: Record<DeveloperOnboardingStep, string> = {
  [DeveloperOnboardingStep.WELCOME]: 'Welcome to SubTrackr Developer Portal',
  [DeveloperOnboardingStep.CREATE_ACCOUNT]: 'Create your developer account',
  [DeveloperOnboardingStep.GENERATE_API_KEY]: 'Generate your API key for sandbox access',
  [DeveloperOnboardingStep.EXPLORE_SANDBOX]: 'Explore the sandbox environment with test data',
  [DeveloperOnboardingStep.BUILD_INTEGRATION]: 'Build your integration using our SDK and guides',
  [DeveloperOnboardingStep.GO_LIVE]: 'Switch to production and go live',
};

class DeveloperOnboardingService {
  private static instance: DeveloperOnboardingService;
  private profile: DeveloperProfile | null = null;

  private constructor() {
    this.loadProfile();
  }

  static getInstance(): DeveloperOnboardingService {
    if (!DeveloperOnboardingService.instance) {
      DeveloperOnboardingService.instance = new DeveloperOnboardingService();
    }
    return DeveloperOnboardingService.instance;
  }

  private async loadProfile(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(DEVELOPER_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.profile = {
          ...parsed,
          createdAt: new Date(parsed.createdAt),
          updatedAt: new Date(parsed.updatedAt),
          sandboxConfig: {
            ...parsed.sandboxConfig,
            createdAt: new Date(parsed.sandboxConfig.createdAt),
            updatedAt: new Date(parsed.sandboxConfig.updatedAt),
          },
          apiKeys: (parsed.apiKeys || []).map((key: Record<string, unknown>) => ({
            ...key,
            createdAt: new Date(key.createdAt as string),
            updatedAt: new Date(key.updatedAt as string),
          })),
        };
      }
    } catch {
      this.profile = null;
    }
  }

  private async saveProfile(): Promise<void> {
    if (!this.profile) return;
    try {
      await AsyncStorage.setItem(DEVELOPER_STORAGE_KEY, JSON.stringify(this.profile));
    } catch (error) {
      console.warn('Failed to save developer profile:', error);
    }
  }

  getProfile(): DeveloperProfile | null {
    return this.profile ? { ...this.profile } : null;
  }

  hasProfile(): boolean {
    return this.profile !== null;
  }

  async createProfile(
    name: string,
    email: string,
    company?: string,
    website?: string
  ): Promise<DeveloperProfile> {
    const sandboxConfig = sandboxService.getConfig();
    const now = new Date();

    this.profile = {
      id: generateId(),
      name,
      email,
      company,
      website,
      onboardingStep: DeveloperOnboardingStep.CREATE_ACCOUNT,
      completedSteps: [DeveloperOnboardingStep.WELCOME],
      sandboxConfig,
      apiKeys: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.saveProfile();
    return { ...this.profile };
  }

  async updateProfile(updates: Partial<DeveloperProfile>): Promise<DeveloperProfile> {
    if (!this.profile) throw new Error('No developer profile found');

    this.profile = {
      ...this.profile,
      ...updates,
      updatedAt: new Date(),
    };

    await this.saveProfile();
    return { ...this.profile };
  }

  async completeStep(step: DeveloperOnboardingStep): Promise<DeveloperProfile> {
    if (!this.profile) throw new Error('No developer profile found');

    const currentCompleted = this.profile.completedSteps || [];
    const completedSteps = [...new Set([...currentCompleted, step])];
    const currentIndex = ONBOARDING_STEP_ORDER.indexOf(step);
    const nextStep = ONBOARDING_STEP_ORDER[currentIndex + 1];

    this.profile = {
      ...this.profile,
      completedSteps,
      onboardingStep: nextStep || this.profile.onboardingStep,
      updatedAt: new Date(),
    };

    await this.saveProfile();
    return { ...this.profile };
  }

  isStepCompleted(step: DeveloperOnboardingStep): boolean {
    return this.profile?.completedSteps?.includes(step) ?? false;
  }

  getCurrentStep(): DeveloperOnboardingStep {
    const step = this.profile?.onboardingStep;
    if (typeof step === 'number') {
      return ONBOARDING_STEP_ORDER[step] || DeveloperOnboardingStep.WELCOME;
    }
    return step || DeveloperOnboardingStep.WELCOME;
  }

  getStepDescription(step: DeveloperOnboardingStep): string {
    return STEP_DESCRIPTIONS[step];
  }

  getOnboardingProgress(): {
    currentStep: DeveloperOnboardingStep;
    completedSteps: DeveloperOnboardingStep[];
    totalSteps: number;
    progress: number;
  } {
    const completedSteps = this.profile?.completedSteps ?? [];
    const totalSteps = ONBOARDING_STEP_ORDER.length;
    const progress = Math.round((completedSteps.length / totalSteps) * 100);

    return {
      currentStep: this.getCurrentStep(),
      completedSteps,
      totalSteps,
      progress,
    };
  }

  getStepOrder(): DeveloperOnboardingStep[] {
    return [...ONBOARDING_STEP_ORDER];
  }

  async generateFirstApiKey(): Promise<string> {
    if (!this.profile) throw new Error('No developer profile found');

    const apiKey = await apiKeyService.createApiKey(
      this.profile.id,
      'Default Sandbox Key',
      SandboxEnvironment.DEVELOPMENT
    );

    this.profile.apiKeys.push(apiKey);
    await this.completeStep(DeveloperOnboardingStep.GENERATE_API_KEY);

    return apiKey.key;
  }

  async resetOnboarding(): Promise<void> {
    if (!this.profile) return;

    this.profile.onboardingStep = DeveloperOnboardingStep.WELCOME;
    this.profile.completedSteps = [];
    this.profile.updatedAt = new Date();
    await this.saveProfile();
  }

  deleteProfile(): void {
    this.profile = null;
    AsyncStorage.removeItem(DEVELOPER_STORAGE_KEY);
  }
}

export const developerOnboardingService = DeveloperOnboardingService.getInstance();
