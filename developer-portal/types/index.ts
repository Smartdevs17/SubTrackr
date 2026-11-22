/**
 * Canonical type barrel for the developer portal.
 *
 * Issue #2061 — Refactor developer portal onto typed server actions.
 *
 * Before this module, types were split across `portal.ts` and `developer.ts`
 * with several interfaces duplicated under the same name but with different
 * shapes (IntegrationGuide, IntegrationStep, QuickLink).  This barrel is the
 * single import point for all consumers: it re-exports the canonical version
 * of each type and documents which file owns it.
 *
 * Duplicate resolution:
 *  - IntegrationGuide / IntegrationStep → portal.ts (used by IntegrationGuidesService)
 *  - QuickLink → portal.ts (has an `id` field; the developer.ts variant does not)
 *
 * Types unique to one file are re-exported as-is.
 */

// ── Portal-facing types (portal.ts) ──────────────────────────────────────────
export type {
  PortalUser,
  PortalDashboard,
  EnvironmentSummary,
  ActivityEntry,
  QuickLink,
  Announcement,
  IntegrationGuide,
  IntegrationStep,
  DocumentationArticle,
  DocumentationSection,
} from './portal';

// ── Developer-lifecycle types (developer.ts) ────────────────────────────────
// IntegrationGuide, IntegrationStep, and QuickLink are intentionally NOT
// re-exported from developer.ts — the portal.ts definitions are canonical.
export type {
  Developer,
  OnboardingStatus,
  ApiKey,
  ApiPermission,
  RateLimit,
  UsageMetrics,
  UsagePeriod,
  DailyUsage,
  EndpointUsage,
  BillingInfo,
  PaymentMethod,
  Invoice,
  UsageCharge,
  Documentation,
  DocCategory,
  DeveloperDashboard,
  SandboxEnvironmentSummary,
  ActivityLog,
  Alert,
} from './developer';
