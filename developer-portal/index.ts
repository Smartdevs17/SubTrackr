export { PortalDashboardService } from './services/portalService';
export {
  DeveloperLifecycleService,
  developerPortalService,
} from './services/developerPortalService';
export { DocumentationService } from './services/documentationService';
export { IntegrationGuidesService } from './services/integrationGuidesService';
export { DeveloperOnboarding } from './components/DeveloperOnboarding';
export { ApiKeyManager } from './components/ApiKeyManager';
export { ApiPlayground } from './components/ApiPlayground';
export {
  ApiKeyIssuanceService,
  ApiKeyIssuanceError,
  apiKeyIssuanceService,
} from './services/apiKeyIssuanceService';
export type {
  IssueApiKeyInput,
  IssuedApiKey,
  AuthorizationResult,
  AuthorizationDenial,
} from './services/apiKeyIssuanceService';
export {
  ALL_SCOPES,
  TIER_KEY_POLICIES,
  normalizeScopes,
  scopeSatisfies,
} from './utils/apiKeyScopes';
export {
  PortalApiKeyRotationService,
  portalApiKeyRotationService,
} from './services/apiKeyRotationService';
export type {
  RotationOptions,
  RotationResult,
  ApiKeyValidationResult,
  ApiKeyRotationMetrics,
} from './services/apiKeyRotationService';
export {
  DashboardPage,
  ApiKeysPage,
  DocumentationPage,
  PlaygroundPage,
  UsagePage,
  OnboardingPage,
  MigrationPage,
  SandboxSettingsPage,
} from './pages';
export type {
  PortalUser,
  PortalDashboard,
  EnvironmentSummary,
  ActivityEntry,
  QuickLink,
  Announcement,
  IntegrationGuide,
  IntegrationStep,
} from './types/portal';

// ── Typed server actions (issue #2061) ───────────────────────────────────────
export {
  type ActionResult,
  type ActionError,
  type ActionFieldError,
  ok,
  fail,
  VALIDATION_ERROR,
  NOT_FOUND,
  CONFLICT,
  FORBIDDEN,
  INTERNAL_ERROR,
  // Schemas
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
  // Observability
  portalLogger,
  portalMetrics,
  // Developer actions
  registerDeveloperAction,
  verifyEmailAction,
  completeOnboardingAction,
  getDeveloperAction,
  updateDeveloperAction,
  // API key actions
  createApiKeyAction,
  revokeApiKeyAction,
  rotateApiKeyAction,
  getApiKeysAction,
  // Usage actions
  getUsageMetricsAction,
  trackUsageAction,
  // Dashboard actions
  getDashboardAction,
  // Documentation actions
  getDocumentationAction,
  getDocumentationSectionsAction,
  getArticleAction,
  searchDocumentationAction,
  getIntegrationGuidesAction,
  getIntegrationGuideAction,
} from './actions';
