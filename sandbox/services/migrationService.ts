/**
 * MigrationService - Manages the sandbox-to-production migration wizard.
 * Handles configuration export, validation checks, data migration,
 * and step-by-step guided migration flow.
 */
import { SandboxEnvironment, SandboxConfig, ApiKey } from '../types/sandbox';

// ─── Migration types ──────────────────────────────────────────────────────────

export interface MigrationChecklistItem {
  id: string;
  category: 'security' | 'configuration' | 'data' | 'integration' | 'compliance';
  title: string;
  description: string;
  status: 'pending' | 'passed' | 'failed' | 'skipped';
  severity: 'critical' | 'warning' | 'info';
  recommendation?: string;
  checkedAt?: Date;
}

export interface MigrationStep {
  id: string;
  order: number;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  checklist: MigrationChecklistItem[];
  startedAt?: Date;
  completedAt?: Date;
}

export interface MigrationPlan {
  id: string;
  sourceEnvironmentId: string;
  sourceEnvironmentName: string;
  status: 'draft' | 'validating' | 'ready' | 'in_progress' | 'completed' | 'failed' | 'rolled_back';
  steps: MigrationStep[];
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  summary: MigrationSummary;
}

export interface MigrationSummary {
  totalSteps: number;
  completedSteps: number;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  criticalFailures: number;
  estimatedTimeMinutes: number;
  canProceed: boolean;
}

export interface MigrationExport {
  version: string;
  exportedAt: Date;
  sourceEnvironment: {
    id: string;
    name: string;
    config: Partial<SandboxConfig>;
  };
  apiKeys: Omit<ApiKey, 'key'>[];
  testConfigurations: Record<string, unknown>;
  webhookConfigs: Record<string, unknown>[];
}

export interface MigrationResult {
  success: boolean;
  productionEnvironmentId?: string;
  errors: string[];
  warnings: string[];
  rollbackAvailable: boolean;
}

// ─── Service ───────────────────────────────────────────────────────────────────

export class MigrationService {
  private plans: Map<string, MigrationPlan> = new Map();
  private exports: Map<string, MigrationExport> = new Map();
  private results: Map<string, MigrationResult> = new Map();

  // ── Checklist templates ─────────────────────────────────────────────────────

  private readonly DEFAULT_CHECKLIST: MigrationChecklistItem[] = [
    {
      id: 'sec_api_keys_rotated',
      category: 'security',
      title: 'API Keys Rotated',
      description: 'Ensure sandbox API keys are rotated and new production keys are generated.',
      status: 'pending',
      severity: 'critical',
      recommendation: 'Generate new production-scoped API keys before migration.',
    },
    {
      id: 'sec_rate_limits_verified',
      category: 'security',
      title: 'Rate Limits Verified',
      description: 'Confirm production rate limits are properly configured.',
      status: 'pending',
      severity: 'warning',
      recommendation: 'Review and adjust production rate limits to match expected traffic.',
    },
    {
      id: 'sec_webhook_secrets',
      category: 'security',
      title: 'Webhook Secrets Updated',
      description: 'Update webhook signing secrets for production endpoints.',
      status: 'pending',
      severity: 'critical',
      recommendation: 'Rotate all webhook secrets before going live.',
    },
    {
      id: 'cfg_isolation_removed',
      category: 'configuration',
      title: 'Sandbox Isolation Removed',
      description: 'Ensure no sandbox-specific isolation flags remain in configuration.',
      status: 'pending',
      severity: 'critical',
    },
    {
      id: 'cfg_features_aligned',
      category: 'configuration',
      title: 'Feature Flags Aligned',
      description: 'Verify feature flags match the production tier.',
      status: 'pending',
      severity: 'warning',
    },
    {
      id: 'cfg_webhooks_configured',
      category: 'configuration',
      title: 'Production Webhooks Configured',
      description: 'All webhook endpoints point to production URLs.',
      status: 'pending',
      severity: 'critical',
      recommendation: 'Replace any localhost/test URLs with production endpoints.',
    },
    {
      id: 'data_test_data_cleared',
      category: 'data',
      title: 'Test Data Cleared',
      description: 'No test or mock data remains in the production environment.',
      status: 'pending',
      severity: 'critical',
      recommendation: 'Run data cleanup to remove all sandbox-generated test data.',
    },
    {
      id: 'data_real_subscriptions',
      category: 'data',
      title: 'Real Subscriptions Ready',
      description: 'Production subscriptions and pricing are configured.',
      status: 'pending',
      severity: 'warning',
    },
    {
      id: 'int_monitoring_setup',
      category: 'integration',
      title: 'Monitoring Configured',
      description: 'Error tracking, logging, and alerting are set up for production.',
      status: 'pending',
      severity: 'warning',
      recommendation: 'Set up production monitoring (Sentry, Datadog, etc.).',
    },
    {
      id: 'int_sla_configured',
      category: 'integration',
      title: 'SLA Configuration',
      description: 'Service level agreement terms are configured for production.',
      status: 'pending',
      severity: 'info',
    },
    {
      id: 'com_gdpr_compliance',
      category: 'compliance',
      title: 'GDPR Compliance Verified',
      description: 'Data handling meets GDPR requirements.',
      status: 'pending',
      severity: 'critical',
      recommendation: 'Review GDPR compliance checklist before going live.',
    },
    {
      id: 'com_tos_accepted',
      category: 'compliance',
      title: 'Terms of Service Accepted',
      description: 'Production Terms of Service have been reviewed and accepted.',
      status: 'pending',
      severity: 'critical',
    },
  ];

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Create a new migration plan for a sandbox environment */
  async createMigrationPlan(sourceEnvironment: SandboxEnvironment): Promise<MigrationPlan> {
    const planId = `mig_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const steps: MigrationStep[] = [
      {
        id: 'step_preflight',
        order: 1,
        title: 'Pre-flight Validation',
        description: 'Run automated checks to verify the sandbox is ready for migration.',
        status: 'pending',
        checklist: this.filterChecklist(['security', 'configuration']),
      },
      {
        id: 'step_export',
        order: 2,
        title: 'Export Configuration',
        description: 'Export sandbox configuration, API key metadata, and webhook settings.',
        status: 'pending',
        checklist: [],
      },
      {
        id: 'step_data_cleanup',
        order: 3,
        title: 'Data Sanitization',
        description: 'Remove all test data and verify no mock data leaks to production.',
        status: 'pending',
        checklist: this.filterChecklist(['data']),
      },
      {
        id: 'step_integration',
        order: 4,
        title: 'Production Integration Setup',
        description: 'Configure production monitoring, SLAs, and integration points.',
        status: 'pending',
        checklist: this.filterChecklist(['integration']),
      },
      {
        id: 'step_final_review',
        order: 5,
        title: 'Final Review & Compliance',
        description: 'Complete final compliance checks and proceed to go-live.',
        status: 'pending',
        checklist: this.filterChecklist(['compliance']),
      },
    ];

    const plan: MigrationPlan = {
      id: planId,
      sourceEnvironmentId: sourceEnvironment.id,
      sourceEnvironmentName: sourceEnvironment.name,
      status: 'draft',
      steps,
      createdAt: new Date(),
      updatedAt: new Date(),
      summary: this.computeSummary(steps),
    };

    this.plans.set(planId, plan);
    return plan;
  }

  /** Get a migration plan by ID */
  async getMigrationPlan(planId: string): Promise<MigrationPlan | null> {
    return this.plans.get(planId) || null;
  }

  /** Start the migration process */
  async startMigration(planId: string): Promise<MigrationPlan | null> {
    const plan = this.plans.get(planId);
    if (!plan) return null;

    plan.status = 'validating';
    plan.updatedAt = new Date();
    this.plans.set(planId, plan);

    // Validate all preflight checks
    await this.runPreflightValidation(plan);

    plan.summary = this.computeSummary(plan.steps);
    plan.status = plan.summary.canProceed ? 'ready' : 'failed';
    plan.updatedAt = new Date();
    this.plans.set(planId, plan);

    return plan;
  }

  /** Execute a specific migration step */
  async executeStep(planId: string, stepId: string): Promise<MigrationStep | null> {
    const plan = this.plans.get(planId);
    if (!plan) return null;

    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) return null;

    step.status = 'in_progress';
    step.startedAt = new Date();
    plan.status = 'in_progress';
    plan.updatedAt = new Date();

    // Simulate running checks for this step
    for (const check of step.checklist) {
      if (check.status === 'pending') {
        // Auto-pass non-critical checks, flag critical ones for review
        check.status = check.severity === 'critical' ? 'failed' : 'passed';
        check.checkedAt = new Date();
      }
    }

    step.status = 'completed';
    step.completedAt = new Date();
    plan.summary = this.computeSummary(plan.steps);
    plan.updatedAt = new Date();
    this.plans.set(planId, plan);

    return step;
  }

  /** Update a checklist item status */
  async updateChecklistItem(
    planId: string,
    stepId: string,
    itemId: string,
    status: MigrationChecklistItem['status']
  ): Promise<MigrationChecklistItem | null> {
    const plan = this.plans.get(planId);
    if (!plan) return null;

    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) return null;

    const item = step.checklist.find((c) => c.id === itemId);
    if (!item) return null;

    item.status = status;
    item.checkedAt = new Date();

    plan.summary = this.computeSummary(plan.steps);
    plan.updatedAt = new Date();
    this.plans.set(planId, plan);

    return item;
  }

  /** Export sandbox configuration for migration */
  async exportConfiguration(environment: SandboxEnvironment): Promise<MigrationExport> {
    const migrationExport: MigrationExport = {
      version: '1.0.0',
      exportedAt: new Date(),
      sourceEnvironment: {
        id: environment.id,
        name: environment.name,
        config: {
          apiVersion: environment.config.apiVersion,
          rateLimits: environment.config.rateLimits,
          features: environment.config.features,
          customDomain: environment.config.customDomain,
          webhookUrl: environment.config.webhookUrl,
          callbackUrl: environment.config.callbackUrl,
        },
      },
      apiKeys: environment.apiKeys
        .filter((k) => k.status === 'active')
        .map(({ key: _key, ...rest }) => rest),
      testConfigurations: {
        subscriptionCount: environment.testData.subscriptions.length,
        paymentCount: environment.testData.payments.length,
        webhookCount: environment.testData.webhooks.length,
        userCount: environment.testData.users.length,
      },
      webhookConfigs: environment.testData.webhooks.map((wh) => ({
        url: wh.url,
        events: wh.events,
      })),
    };

    this.exports.set(environment.id, migrationExport);
    return migrationExport;
  }

  /** Complete the migration and simulate production setup */
  async completeMigration(planId: string): Promise<MigrationResult> {
    const plan = this.plans.get(planId);
    if (!plan) {
      return {
        success: false,
        errors: ['Migration plan not found'],
        warnings: [],
        rollbackAvailable: false,
      };
    }

    if (!plan.summary.canProceed) {
      return {
        success: false,
        errors:
          plan.summary.failedChecks > 0
            ? ['Critical checks have failed. Please resolve before proceeding.']
            : ['Unable to proceed with migration.'],
        warnings: [],
        rollbackAvailable: false,
      };
    }

    plan.status = 'completed';
    plan.completedAt = new Date();
    plan.updatedAt = new Date();
    this.plans.set(planId, plan);

    const result: MigrationResult = {
      success: true,
      productionEnvironmentId: `prod_${Date.now()}`,
      errors: [],
      warnings: [
        'Remember to rotate ALL API keys',
        'Monitor production traffic for first 24 hours',
        'Keep sandbox environment active for rollback purposes',
      ],
      rollbackAvailable: true,
    };

    this.results.set(planId, result);
    return result;
  }

  /** Rollback a completed migration */
  async rollbackMigration(planId: string): Promise<boolean> {
    const plan = this.plans.get(planId);
    const result = this.results.get(planId);

    if (!plan || !result?.rollbackAvailable) return false;

    plan.status = 'rolled_back';
    plan.updatedAt = new Date();
    this.plans.set(planId, plan);

    return true;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async runPreflightValidation(plan: MigrationPlan): Promise<void> {
    for (const step of plan.steps) {
      for (const check of step.checklist) {
        // Simulate validation delay
        await this.delay(30 + Math.random() * 70);

        // In a real implementation, this would run actual validation logic
        // For sandbox, critical security checks are auto-passed for demo
        if (check.severity === 'critical') {
          check.status = Math.random() > 0.15 ? 'passed' : 'failed';
        } else if (check.severity === 'warning') {
          check.status = Math.random() > 0.3 ? 'passed' : 'failed';
        } else {
          check.status = 'passed';
        }
        check.checkedAt = new Date();
      }
    }
  }

  private filterChecklist(
    categories: MigrationChecklistItem['category'][]
  ): MigrationChecklistItem[] {
    return this.DEFAULT_CHECKLIST.filter((item) => categories.includes(item.category)).map(
      (item) => ({ ...item, status: 'pending' as const, checkedAt: undefined })
    );
  }

  private computeSummary(steps: MigrationStep[]): MigrationSummary {
    let totalChecks = 0;
    let passedChecks = 0;
    let failedChecks = 0;
    let criticalFailures = 0;

    for (const step of steps) {
      for (const check of step.checklist) {
        totalChecks++;
        if (check.status === 'passed') passedChecks++;
        if (check.status === 'failed') {
          failedChecks++;
          if (check.severity === 'critical') criticalFailures++;
        }
      }
    }

    const completedSteps = steps.filter((s) => s.status === 'completed').length;

    return {
      totalSteps: steps.length,
      completedSteps,
      totalChecks,
      passedChecks,
      failedChecks,
      criticalFailures,
      estimatedTimeMinutes: steps.length * 3,
      canProceed: criticalFailures === 0,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const migrationService = new MigrationService();
