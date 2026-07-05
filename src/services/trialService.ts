import {
  TrialConfig,
  TrialDuration,
  TrialFeatureAccess,
  PaymentRequirement,
  TrialStatus,
  ABTestAssignment,
  ConversionFunnelEvent,
  TrialReminderSchedule,
  TrialReminder,
} from '../types/trial';
import AsyncStorage from '@react-native-async-storage/async-storage';

const TRIAL_CONFIGS_KEY = 'subtrackr-trial-configs';
const AB_TEST_ASSIGNMENTS_KEY = 'subtrackr-ab-test-assignments';
const FUNNEL_EVENTS_KEY = 'subtrackr-funnel-events';
const REMINDER_SCHEDULES_KEY = 'subtrackr-reminder-schedules';

class TrialConfigService {
  private configs: TrialConfig[] = [];

  async load(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(TRIAL_CONFIGS_KEY);
      if (stored) {
        this.configs = JSON.parse(stored);
      }
    } catch {
      this.configs = [];
    }
  }

  async save(): Promise<void> {
    try {
      await AsyncStorage.setItem(TRIAL_CONFIGS_KEY, JSON.stringify(this.configs));
    } catch {
      // ignore
    }
  }

  create(
    subscriptionId: string,
    duration: TrialDuration,
    featureAccess: TrialFeatureAccess,
    paymentRequirement: PaymentRequirement,
    abTestId?: string
  ): TrialConfig {
    const now = new Date();
    const endDate = new Date(now);
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

    const config: TrialConfig = {
      id: `${subscriptionId}-${Date.now()}`,
      subscriptionId,
      duration,
      featureAccess,
      paymentRequirement,
      abTestId,
      status: TrialStatus.ACTIVE,
      startDate: now,
      endDate,
      createdAt: now,
      updatedAt: now,
    };

    this.configs.push(config);
    this.save();
    return config;
  }

  update(id: string, updates: Partial<TrialConfig>): TrialConfig | null {
    const index = this.configs.findIndex((c) => c.id === id);
    if (index === -1) return null;

    this.configs[index] = {
      ...this.configs[index],
      ...updates,
      updatedAt: new Date(),
    };
    this.save();
    return this.configs[index];
  }

  validate(config: Partial<TrialConfig>): { valid: boolean; errors: string[] } {
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

  getBySubscriptionId(subscriptionId: string): TrialConfig | undefined {
    return this.configs.find((c) => c.subscriptionId === subscriptionId);
  }

  getAll(): TrialConfig[] {
    return [...this.configs];
  }
}

class ABTestService {
  private assignments: ABTestAssignment[] = [];

  async load(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(AB_TEST_ASSIGNMENTS_KEY);
      if (stored) {
        this.assignments = JSON.parse(stored);
      }
    } catch {
      this.assignments = [];
    }
  }

  async save(): Promise<void> {
    try {
      await AsyncStorage.setItem(AB_TEST_ASSIGNMENTS_KEY, JSON.stringify(this.assignments));
    } catch {
      // ignore
    }
  }

  assignCohort(abTestId: string, userId: string, variantName: string, cohort?: string): ABTestAssignment {
    const now = new Date();
    const assignment: ABTestAssignment = {
      id: `${abTestId}-${userId}-${Date.now()}`,
      abTestId,
      userId,
      variantName,
      assignedAt: now,
      cohort,
    };

    this.assignments.push(assignment);
    this.save();
    return assignment;
  }

  getAssignmentsForTest(abTestId: string): ABTestAssignment[] {
    return this.assignments.filter((a) => a.abTestId === abTestId);
  }

  getAssignmentsForUser(userId: string): ABTestAssignment[] {
    return this.assignments.filter((a) => a.userId === userId);
  }

  getVariantDistribution(abTestId: string): Record<string, number> {
    const testAssignments = this.getAssignmentsForTest(abTestId);
    return testAssignments.reduce<Record<string, number>>((acc, a) => {
      acc[a.variantName] = (acc[a.variantName] || 0) + 1;
      return acc;
    }, {});
  }
}

class ConversionTracker {
  private events: ConversionFunnelEvent[] = [];

  async load(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(FUNNEL_EVENTS_KEY);
      if (stored) {
        this.events = JSON.parse(stored);
      }
    } catch {
      this.events = [];
    }
  }

  async save(): Promise<void> {
    try {
      await AsyncStorage.setItem(FUNNEL_EVENTS_KEY, JSON.stringify(this.events));
    } catch {
      // ignore
    }
  }

  track(event: Omit<ConversionFunnelEvent, 'id' | 'timestamp'>): ConversionFunnelEvent {
    const funnelEvent: ConversionFunnelEvent = {
      ...event,
      id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date(),
    };

    this.events.push(funnelEvent);
    this.save();
    return funnelEvent;
  }

  getFunnelForTrial(trialConfigId: string): ConversionFunnelEvent[] {
    return this.events.filter((e) => e.trialConfigId === trialConfigId);
  }

  getFunnelForABTest(abTestId: string): ConversionFunnelEvent[] {
    const trialConfigs = trialConfigService.getAll().filter((c) => c.abTestId === abTestId);
    const trialIds = new Set(trialConfigs.map((c) => c.id));
    return this.events.filter((e) => trialIds.has(e.trialConfigId));
  }

  getConversionRate(abTestId?: string): number {
    const events = abTestId ? this.getFunnelForABTest(abTestId) : this.events;
    const starts = events.filter((e) => e.eventType === 'trial_started').length;
    const conversions = events.filter((e) => e.eventType === 'trial_converted').length;
    return starts > 0 ? conversions / starts : 0;
  }

  getFunnelSteps(abTestId?: string): Record<string, number> {
    const events = abTestId ? this.getFunnelForABTest(abTestId) : this.events;
    return events.reduce<Record<string, number>>((acc, e) => {
      acc[e.eventType] = (acc[e.eventType] || 0) + 1;
      return acc;
    }, {});
  }
}

class ReminderScheduler {
  private schedules: TrialReminderSchedule[] = [];

  async load(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(REMINDER_SCHEDULES_KEY);
      if (stored) {
        this.schedules = JSON.parse(stored);
      }
    } catch {
      this.schedules = [];
    }
  }

  async save(): Promise<void> {
    try {
      await AsyncStorage.setItem(REMINDER_SCHEDULES_KEY, JSON.stringify(this.schedules));
    } catch {
      // ignore
    }
  }

  createSchedule(trialConfigId: string, userId: string): TrialReminderSchedule {
    const now = new Date();
    const reminders: TrialReminder[] = [
      {
        id: `rem-d3-${Date.now()}`,
        type: 'D-3',
        scheduledAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
        sent: false,
        message: 'Your trial ends in 3 days. Convert now to keep your subscription.',
      },
      {
        id: `rem-d1-${Date.now()}`,
        type: 'D-1',
        scheduledAt: new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000),
        sent: false,
        message: 'Your trial ends tomorrow. Convert now to avoid interruption.',
      },
      {
        id: `rem-dd-${Date.now()}`,
        type: 'D-DAY',
        scheduledAt: new Date(now.getTime()),
        sent: false,
        message: 'Your trial ends today. Convert now to continue your subscription.',
      },
    ];

    const schedule: TrialReminderSchedule = {
      id: `sched-${trialConfigId}`,
      trialConfigId,
      userId,
      reminders,
      createdAt: now,
    };

    this.schedules.push(schedule);
    this.save();
    return schedule;
  }

  getByTrialConfigId(trialConfigId: string): TrialReminderSchedule | undefined {
    return this.schedules.find((s) => s.trialConfigId === trialConfigId);
  }

  markSent(reminderId: string): void {
    for (const schedule of this.schedules) {
      const reminder = schedule.reminders.find((r) => r.id === reminderId);
      if (reminder) {
        reminder.sent = true;
        reminder.sentAt = new Date();
        break;
      }
    }
    this.save();
  }

  getPendingReminders(): TrialReminder[] {
    const now = new Date();
    const pending: TrialReminder[] = [];
    for (const schedule of this.schedules) {
      for (const reminder of schedule.reminders) {
        if (!reminder.sent && reminder.scheduledAt <= now) {
          pending.push({ ...reminder, sentAt: reminder.sentAt });
        }
      }
    }
    return pending;
  }
}

export const trialConfigService = new TrialConfigService();
export const abTestService = new ABTestService();
export const conversionTracker = new ConversionTracker();
export const reminderScheduler = new ReminderScheduler();
