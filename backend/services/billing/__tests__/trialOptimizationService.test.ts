import { TrialManagementService } from '../trialManagementService';
import { TrialOptimizationService } from '../trialOptimizationService';

describe('trial optimization service', () => {
  let trials: TrialManagementService;
  let service: TrialOptimizationService;

  beforeEach(() => {
    trials = new TrialManagementService();
    service = new TrialOptimizationService(trials);
  });

  it('recommends conversion for highly engaged trials', () => {
    const trial = trials.startTrial('user_high', 'pro', 19.99);
    trials.recordActivity(trial.id, {
      featureUsageCount: 20,
      loginCount: 20,
      dashboardViews: 20,
      exportsTriggered: 20,
    });

    const recommendation = service.evaluateTrial(trial.id);

    expect(recommendation?.category).toBe('high_propensity');
    expect(recommendation?.action).toBe('convert_now');
    expect(recommendation?.score).toBe(100);
  });

  it('attaches an incentive to medium-propensity trials', () => {
    const trial = trials.startTrial('user_medium', 'pro', 19.99);
    trials.recordActivity(trial.id, { featureUsageCount: 6, loginCount: 2 });

    const recommendation = service.evaluateTrial(trial.id);

    expect(recommendation?.category).toBe('medium_propensity');
    expect(recommendation?.action).toBe('offer_incentive');
    expect(recommendation?.incentive?.discountPercentage).toBe(15);
  });

  it('returns undefined for unknown trials and evaluates only active trials', () => {
    const trial = trials.startTrial('user_active', 'pro', 19.99);
    trials.cancelTrial(trial.id);

    expect(service.evaluateTrial('missing')).toBeUndefined();
    expect(service.evaluateAllTrials()).toHaveLength(0);
  });

  it('runs automated expiration workflow with reminder counts', () => {
    const trial = trials.startTrial('user_expired', 'pro', 19.99, { durationDays: 1, gracePeriodDays: 1 });
    const reference = new Date(trial.gracePeriodEndDate.getTime() + 60_000);

    const report = service.runExpirationWorkflow(reference);

    expect(report.autoConverted).toBe(1);
    expect(report.trialIds).toContain(trial.id);
    expect(report.processedAt).toEqual(reference);
    expect(service.getFunnelMetrics().convertedCount).toBe(1);
    expect(service.getPendingReminders().length).toBeGreaterThan(0);
  });
});
