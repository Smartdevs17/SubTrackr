export type {
  PlanMetadata,
  PlanLimits,
  PlanMetadataConfig,
  CreatePlanInput,
  UpdatePlanInput,
} from './types';
export type { IPlanRepository } from './PlanRepository';
export { InMemoryPlanRepository } from './PlanRepository';
export { PostgresPlanRepository, planMetadataToRow } from './PostgresPlanRepository';
export { PlanCacheService } from './PlanCacheService';
export type { PlanCacheConfig } from './PlanCacheService';

// Pause / resume (Issue #1723)
export {
  pauseWindowRegistry,
  PauseWindowRegistry,
  DEFAULT_PAUSE_LIMITS,
  buildPauseBillingAdjustment,
  calculatePauseCredit,
  calculateResumeCredit,
  validatePauseRequest,
  getPeriodDays,
  daysBetween,
  daysFromNow,
  isResumeDue,
  CREDIT_EXPIRY_DAYS,
} from './pauseBilling';
export type {
  PauseLimits,
  PauseBillingInput,
  PauseBillingAdjustment,
  ResumeBillingInput,
  ResumeBillingAdjustment,
  PauseReason,
  PlanPauseWindow,
} from './pauseBilling';
export { pauseStateStore, PauseStateStore } from './pauseStateStore';
export type { PauseSession, PauseStatus, PauseStoreSeed } from './pauseStateStore';
