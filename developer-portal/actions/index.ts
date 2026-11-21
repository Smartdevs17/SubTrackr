/**
 * Barrel export for developer-portal server actions.
 *
 * Issue #2061 — Refactor developer portal onto typed server actions.
 *
 * Import from here, not from individual action files:
 *   import { createApiKeyAction, getDashboardAction } from '../actions';
 */

// ── Result types ─────────────────────────────────────────────────────────────
export { ok, fail, type ActionResult, type ActionError, type ActionFieldError } from './result';
export { VALIDATION_ERROR, NOT_FOUND, CONFLICT, FORBIDDEN, INTERNAL_ERROR } from './result';

// ── Schemas (for client-side pre-validation if desired) ─────────────────────
export {
  registerDeveloperSchema,
  verifyEmailSchema,
  completeOnboardingSchema,
  getDeveloperSchema,
  updateDeveloperSchema,
  createApiKeySchema,
  revokeApiKeySchema,
  rotateApiKeySchema,
  getApiKeysSchema,
  getUsageMetricsSchema,
  trackUsageSchema,
  getDashboardSchema,
  getDocumentationSchema,
  searchDocumentationSchema,
  getArticleSchema,
  getIntegrationGuidesSchema,
  getIntegrationGuideSchema,
} from './schemas';

// ── Observability ────────────────────────────────────────────────────────────
export { portalLogger, portalMetrics, withAction } from './observability';

// ── Developer actions ────────────────────────────────────────────────────────
export {
  registerDeveloperAction,
  verifyEmailAction,
  completeOnboardingAction,
  getDeveloperAction,
  updateDeveloperAction,
} from './developerActions';

// ── API key actions ──────────────────────────────────────────────────────────
export {
  createApiKeyAction,
  revokeApiKeyAction,
  rotateApiKeyAction,
  getApiKeysAction,
} from './apiKeyActions';

// ── Usage actions ─────────────────────────────────────────────────────────────
export { getUsageMetricsAction, trackUsageAction } from './usageActions';

// ── Dashboard actions ────────────────────────────────────────────────────────
export { getDashboardAction } from './dashboardActions';

// ── Documentation actions ────────────────────────────────────────────────────
export {
  getDocumentationAction,
  getDocumentationSectionsAction,
  getArticleAction,
  searchDocumentationAction,
  getIntegrationGuidesAction,
  getIntegrationGuideAction,
} from './documentationActions';
