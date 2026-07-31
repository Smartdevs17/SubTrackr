/**
 * Frontend MigrationService - Client-side bridge to the sandbox migration wizard.
 * Integrates with the backend MigrationService and AsyncStorage for state.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const MIGRATION_STORAGE_KEY = '@subtrackr_migration_state';

export interface MigrationChecklistItem {
  id: string;
  category: 'security' | 'configuration' | 'data' | 'integration' | 'compliance';
  title: string;
  description: string;
  status: 'pending' | 'passed' | 'failed' | 'skipped';
  severity: 'critical' | 'warning' | 'info';
  recommendation?: string;
}

export interface MigrationStep {
  id: string;
  order: number;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  checklist: MigrationChecklistItem[];
}

export interface MigrationPlan {
  id: string;
  sourceEnvironmentId: string;
  sourceEnvironmentName: string;
  status: 'draft' | 'validating' | 'ready' | 'in_progress' | 'completed' | 'failed';
  steps: MigrationStep[];
  createdAt: Date;
  updatedAt: Date;
  summary: {
    totalSteps: number;
    completedSteps: number;
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
    criticalFailures: number;
    canProceed: boolean;
  };
}

export interface MigrationResult {
  success: boolean;
  productionEnvironmentId?: string;
  errors: string[];
  warnings: string[];
}

class MigrationService {
  private static instance: MigrationService;
  private plans: MigrationPlan[] = [];
  private currentPlan: MigrationPlan | null = null;

  private constructor() {
    this.loadPlans();
  }

  static getInstance(): MigrationService {
    if (!MigrationService.instance) {
      MigrationService.instance = new MigrationService();
    }
    return MigrationService.instance;
  }

  private async loadPlans(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(MIGRATION_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.plans = parsed.map((p: Record<string, unknown>) => ({
          ...p,
          createdAt: new Date(p.createdAt as string),
          updatedAt: new Date(p.updatedAt as string),
        }));
        this.currentPlan =
          this.plans.find((p) => p.status !== 'completed' && p.status !== 'failed') || null;
      }
    } catch {
      this.plans = [];
    }
  }

  private async savePlans(): Promise<void> {
    try {
      await AsyncStorage.setItem(MIGRATION_STORAGE_KEY, JSON.stringify(this.plans));
    } catch (error) {
      console.warn('Failed to save migration plans:', error);
    }
  }

  /** Create a new migration plan for going from sandbox to production */
  async createMigrationPlan(
    environmentId: string,
    environmentName: string
  ): Promise<MigrationPlan> {
    const planId = `mig_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const plan: MigrationPlan = {
      id: planId,
      sourceEnvironmentId: environmentId,
      sourceEnvironmentName: environmentName,
      status: 'draft',
      steps: [
        {
          id: 'step_preflight',
          order: 1,
          title: 'Pre-flight Validation',
          description: 'Verify sandbox environment is ready for migration.',
          status: 'pending',
          checklist: [
            {
              id: 'sec_api_keys',
              category: 'security',
              title: 'API Keys Rotated',
              description: 'New production-scoped API keys generated.',
              status: 'pending',
              severity: 'critical',
              recommendation: 'Generate new production keys before migration.',
            },
            {
              id: 'sec_rate_limits',
              category: 'security',
              title: 'Rate Limits Configured',
              description: 'Production rate limits match expected traffic.',
              status: 'pending',
              severity: 'warning',
            },
            {
              id: 'cfg_isolation',
              category: 'configuration',
              title: 'Sandbox Isolation Removed',
              description: 'No sandbox-specific flags in configuration.',
              status: 'pending',
              severity: 'critical',
            },
            {
              id: 'cfg_webhooks',
              category: 'configuration',
              title: 'Production Webhooks Set',
              description: 'Webhook URLs point to production endpoints.',
              status: 'pending',
              severity: 'critical',
            },
          ],
        },
        {
          id: 'step_export',
          order: 2,
          title: 'Export Configuration',
          description: 'Export sandbox settings for production import.',
          status: 'pending',
          checklist: [],
        },
        {
          id: 'step_cleanup',
          order: 3,
          title: 'Data Sanitization',
          description: 'Clear all test data and mock records.',
          status: 'pending',
          checklist: [
            {
              id: 'data_test_cleared',
              category: 'data',
              title: 'Test Data Removed',
              description: 'All mock subscriptions and payments cleared.',
              status: 'pending',
              severity: 'critical',
            },
            {
              id: 'data_real_ready',
              category: 'data',
              title: 'Production Data Configured',
              description: 'Real pricing and subscription plans ready.',
              status: 'pending',
              severity: 'warning',
            },
          ],
        },
        {
          id: 'step_integration',
          order: 4,
          title: 'Integration Setup',
          description: 'Set up production monitoring and integrations.',
          status: 'pending',
          checklist: [
            {
              id: 'int_monitoring',
              category: 'integration',
              title: 'Monitoring Active',
              description: 'Error tracking and alerts configured.',
              status: 'pending',
              severity: 'warning',
            },
          ],
        },
        {
          id: 'step_review',
          order: 5,
          title: 'Final Review',
          description: 'Complete compliance checks and go live.',
          status: 'pending',
          checklist: [
            {
              id: 'com_tos',
              category: 'compliance',
              title: 'Terms Accepted',
              description: 'Production ToS reviewed and accepted.',
              status: 'pending',
              severity: 'critical',
            },
          ],
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
      summary: {
        totalSteps: 5,
        completedSteps: 0,
        totalChecks: 0,
        passedChecks: 0,
        failedChecks: 0,
        criticalFailures: 0,
        canProceed: false,
      },
    };

    this.plans.push(plan);
    this.currentPlan = plan;
    await this.savePlans();
    return plan;
  }

  /** Get current migration plan */
  getCurrentPlan(): MigrationPlan | null {
    return this.currentPlan;
  }

  /** Start the validation phase */
  async startValidation(): Promise<MigrationPlan | null> {
    if (!this.currentPlan) return null;

    this.currentPlan.status = 'validating';
    this.currentPlan.steps[0].status = 'in_progress';

    // Simulate validation
    for (const check of this.currentPlan.steps[0].checklist) {
      check.status = Math.random() > 0.2 ? 'passed' : 'failed';
    }

    this.currentPlan.steps[0].status = 'completed';
    this.updateSummary();
    this.currentPlan.status = this.currentPlan.summary.canProceed ? 'ready' : 'failed';
    this.currentPlan.updatedAt = new Date();

    await this.savePlans();
    return this.currentPlan;
  }

  /** Execute a specific step */
  async executeStep(stepId: string): Promise<MigrationStep | null> {
    if (!this.currentPlan) return null;

    const step = this.currentPlan.steps.find((s) => s.id === stepId);
    if (!step) return null;

    step.status = 'in_progress';
    this.currentPlan.status = 'in_progress';
    this.currentPlan.updatedAt = new Date();

    // Simulate step execution
    await this.delay(500 + Math.random() * 1000);

    step.status = 'completed';
    this.updateSummary();
    this.currentPlan.updatedAt = new Date();

    // Check if all steps done
    if (this.currentPlan.steps.every((s) => s.status === 'completed')) {
      this.currentPlan.status = 'completed';
    }

    await this.savePlans();
    return step;
  }

  /** Update a checklist item */
  async updateChecklistItem(
    stepId: string,
    itemId: string,
    status: MigrationChecklistItem['status']
  ): Promise<void> {
    if (!this.currentPlan) return;

    const step = this.currentPlan.steps.find((s) => s.id === stepId);
    if (!step) return;

    const item = step.checklist.find((c) => c.id === itemId);
    if (!item) return;

    item.status = status;
    this.updateSummary();
    this.currentPlan.updatedAt = new Date();
    await this.savePlans();
  }

  /** Complete migration */
  async completeMigration(): Promise<MigrationResult> {
    if (!this.currentPlan) {
      return { success: false, errors: ['No migration plan active'], warnings: [] };
    }

    this.currentPlan.status = 'completed';
    this.currentPlan.updatedAt = new Date();
    await this.savePlans();

    return {
      success: true,
      productionEnvironmentId: `prod_${Date.now()}`,
      errors: [],
      warnings: [
        'Rotate all API keys for production',
        'Monitor production traffic for 24 hours',
        'Keep sandbox for rollback',
      ],
    };
  }

  /** Reset/clear migration state */
  async resetMigration(): Promise<void> {
    this.plans = [];
    this.currentPlan = null;
    await AsyncStorage.removeItem(MIGRATION_STORAGE_KEY);
  }

  private updateSummary(): void {
    if (!this.currentPlan) return;

    let totalChecks = 0;
    let passedChecks = 0;
    let failedChecks = 0;
    let criticalFailures = 0;

    for (const step of this.currentPlan.steps) {
      for (const check of step.checklist) {
        totalChecks++;
        if (check.status === 'passed') passedChecks++;
        if (check.status === 'failed') {
          failedChecks++;
          if (check.severity === 'critical') criticalFailures++;
        }
      }
    }

    const completedSteps = this.currentPlan.steps.filter((s) => s.status === 'completed').length;

    this.currentPlan.summary = {
      totalSteps: this.currentPlan.steps.length,
      completedSteps,
      totalChecks,
      passedChecks,
      failedChecks,
      criticalFailures,
      canProceed: criticalFailures === 0,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const migrationService = MigrationService.getInstance();
