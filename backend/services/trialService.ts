import {
  TrialConfig,
  ABTestAssignment,
  ConversionFunnelEvent,
  TrialReminderSchedule,
  TrialStatus,
  TrialDuration,
  TrialFeatureAccess,
  PaymentRequirement,
} from '../../src/types/trial';

interface BackendTrialConfig {
  id: string;
  subscriptionId: string;
  duration: TrialDuration;
  featureAccess: TrialFeatureAccess;
  paymentRequirement: PaymentRequirement;
  abTestId?: string;
  status: TrialStatus;
  startDate?: string;
  endDate?: string;
  convertedAt?: string;
  reminderScheduleId?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

interface BackendABTestAssignment {
  id: string;
  abTestId: string;
  userId: string;
  variantName: string;
  assignedAt: string;
  cohort?: string;
}

interface BackendConversionFunnelEvent {
  id: string;
  trialConfigId: string;
  eventType: ConversionFunnelEvent['eventType'];
  userId: string;
  variantName?: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export class BackendTrialService {
  private trialConfigs: Map<string, BackendTrialConfig> = new Map();
  private assignments: Map<string, BackendABTestAssignment> = new Map();
  private funnelEvents: Map<string, BackendConversionFunnelEvent> = new Map();

  createTrialConfig(
    subscriptionId: string,
    duration: TrialDuration,
    featureAccess: TrialFeatureAccess,
    paymentRequirement: PaymentRequirement,
    abTestId?: string
  ): BackendTrialConfig {
    const now = new Date().toISOString();
    const endDate = new Date();
    switch (duration) {
      case TrialDuration.SEVEN_DAYS:
        endDate.setDate(endDate.getDate() + 7);
        break;
      case TrialDuration.FOURTEEN_DAYS:
        endDate.setDate(endDate.getDate() + 14);
        break;
      case TrialDuration.TWENTY_ONE_DAYS:
        endDate.setDate(endDate.getDate() + 21);
        break;
      case TrialDuration.THIRTY_DAYS:
        endDate.setDate(endDate.getDate() + 30);
        break;
    }

    const config: BackendTrialConfig = {
      id: `${subscriptionId}-${Date.now()}`,
      subscriptionId,
      duration,
      featureAccess,
      paymentRequirement,
      abTestId,
      status: TrialStatus.ACTIVE,
      startDate: now,
      endDate: endDate.toISOString(),
      createdAt: now,
      updatedAt: now,
    };

    this.trialConfigs.set(config.id, config);
    return config;
  }

  validateTrialConfig(config: Partial<BackendTrialConfig>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.subscriptionId) {
      errors.push('Subscription ID is required');
    }
    if (!config.duration) {
      errors.push('Trial duration is required');
    }
    if (!config.featureAccess) {
      errors.push('Feature access is required');
    }
    if (!config.paymentRequirement) {
      errors.push('Payment requirement is required');
    }

    return { valid: errors.length === 0, errors };
  }

  assignABTest(abTestId: string, userId: string, variantName: string, cohort?: string): BackendABTestAssignment {
    const assignment: BackendABTestAssignment = {
      id: `${abTestId}-${userId}-${Date.now()}`,
      abTestId,
      userId,
      variantName,
      assignedAt: new Date().toISOString(),
      cohort,
    };

    this.assignments.set(assignment.id, assignment);
    return assignment;
  }

  processFunnelEvent(event: Omit<BackendConversionFunnelEvent, 'id' | 'timestamp'>): BackendConversionFunnelEvent {
    const funnelEvent: BackendConversionFunnelEvent = {
      ...event,
      id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
    };

    this.funnelEvents.set(funnelEvent.id, funnelEvent);
    return funnelEvent;
  }

  getTrialConfig(id: string): BackendTrialConfig | undefined {
    return this.trialConfigs.get(id);
  }

  getTrialConfigBySubscription(subscriptionId: string): BackendTrialConfig | undefined {
    for (const config of this.trialConfigs.values()) {
      if (config.subscriptionId === subscriptionId) {
        return config;
      }
    }
    return undefined;
  }

  getAssignmentsForTest(abTestId: string): BackendABTestAssignment[] {
    return Array.from(this.assignments.values()).filter((a) => a.abTestId === abTestId);
  }

  getFunnelEvents(trialConfigId: string): BackendConversionFunnelEvent[] {
    return Array.from(this.funnelEvents.values()).filter((e) => e.trialConfigId === trialConfigId);
  }

  getConversionStats(abTestId?: string): { totalTrials: number; convertedTrials: number; conversionRate: number } {
    const configs = abTestId
      ? Array.from(this.trialConfigs.values()).filter((c) => c.abTestId === abTestId)
      : Array.from(this.trialConfigs.values());

    const totalTrials = configs.length;
    const convertedTrials = configs.filter((c) => c.status === TrialStatus.CONVERTED).length;
    const conversionRate = totalTrials > 0 ? convertedTrials / totalTrials : 0;

    return { totalTrials, convertedTrials, conversionRate };
  }

  convertTrial(trialId: string): BackendTrialConfig | undefined {
    const config = this.trialConfigs.get(trialId);
    if (!config) return undefined;

    config.status = TrialStatus.CONVERTED;
    config.convertedAt = new Date().toISOString();
    config.updatedAt = new Date().toISOString();
    return config;
  }

  expireTrial(trialId: string): BackendTrialConfig | undefined {
    const config = this.trialConfigs.get(trialId);
    if (!config) return undefined;

    config.status = TrialStatus.EXPIRED;
    config.updatedAt = new Date().toISOString();
    return config;
  }
}

export const backendTrialService = new BackendTrialService();
