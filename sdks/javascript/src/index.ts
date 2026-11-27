export { SubTrackrClient } from './client';
export type {
  SDKOptions,
  Plan,
  Subscription,
  Webhook,
  BillingInterval,
  Interval,
  SubscriptionStatus,
} from './types';
export {
  INTERVALS,
  INTERVAL_SECONDS,
  SUBSCRIPTION_STATUSES,
  intervalSeconds,
  isInterval,
  isSubscriptionStatus,
} from '../../../shared/types/contract';
export {
  ApiError,
  AuthenticationError,
  SubTrackrError,
  UnsupportedVersionError,
  VersionMismatchError,
  parseErrorBody,
  apiErrorFromBody,
} from './errors';
export type { ParsedErrorBody } from './errors';
export { TypedSubTrackrClient } from './typedClient';
export type {
  TypedClientOptions,
  RequestOptions,
  ApiSuccessEnvelope,
  ApiErrorEnvelope,
  ApiEnvelope,
  PaginationMeta,
  ClientMetrics,
} from './typedClient';
export { withRetry, RetryableError, isRetryableStatus, parseRetryAfterMs } from './retry';
export type { RetryOptions, RetryResult } from './retry';

// ── Circuit breaker & resilience (Issue #2216) ────────────────────────────────
export { CircuitBreaker, CircuitOpenError } from './circuitBreaker';
export type { CircuitBreakerOptions, CircuitState } from './circuitBreaker';
export { withResilience, withResilienceAndBreaker } from './resilience';
export type { ResilienceOptions, ResilienceResult } from './resilience';

// ── Versioning & deprecation ─────────────────────────────────────────────────
export {
  SDK_VERSION,
  SDK_VERSION_INFO,
  CURRENT_API_VERSION,
  MIN_SUPPORTED_API_VERSION,
  REMOVED_API_VERSIONS,
  assessApiVersionCompatibility,
  parseSemVer,
  compareSemVer,
  satisfiesMinVersion,
} from './version';
export type { VersionCompatibility, SemVer } from './version';

export {
  RemovedError,
  DeprecationRegistry,
  warnDeprecated,
  throwIfRemoved,
  deprecated,
  withDeprecationWarning,
} from './deprecation';
export type { DeprecationNotice } from './deprecation';
