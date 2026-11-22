/**
 * Lifecycle module — public API barrel.
 *
 * Covers all subscription state-transition concerns: cancellation,
 * pause/resume, trials, renewal, event store, and SLA monitoring.
 */

// Types
export type {
  SubscriptionStatus,
  CancellationMode,
  CancellationReason,
  CancellationRequest,
  CancellationResult,
  PauseReason,
  PauseRequest,
  PauseResult,
  ResumeRequest,
  ResumeResult,
  TrialStatus,
  TrialRecord,
  StartTrialRequest,
  ConvertTrialRequest,
  RenewalRequest,
  RenewalResult,
  LifecycleEventType,
  LifecycleEvent,
  SlaMetricKind,
  SubscriptionTier,
  SlaTarget,
  SlaBreachRecord,
} from './types';

// Errors
export { LifecycleError, LifecycleErrorCode } from './errors';

// Services
export { CancellationService, cancellationService } from './cancellationService';
export { PauseResumeService, pauseResumeService } from './pauseResumeService';
export { TrialService, trialService } from './trialService';
export { LifecycleEventStore, lifecycleEventStore } from './eventStore';
export type { LifecycleEventQuery, LifecycleEventPage } from './eventStore';
export { SlaMonitoringService, slaMonitoringService } from './slaMonitoringService';
export type { SlaMetricSample } from './slaMonitoringService';
