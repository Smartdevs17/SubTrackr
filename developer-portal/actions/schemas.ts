/**
 * Zod input schemas for developer-portal server actions.
 *
 * Issue #2061 — Refactor developer portal onto typed server actions.
 *
 * Every action validates its input with a schema from this module before
 * touching a backing service.  Schemas are co-located with their action so
 * a reader can see the full contract in one place, and exported individually
 * so callers can re-validate on the client side if desired.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Primitives reused across actions
// ─────────────────────────────────────────────────────────────────────────────

export const developerIdSchema = z.string().min(1, 'developerId is required');

export const apiKeyIdSchema = z.string().min(1, 'apiKeyId is required');

export const apiKeyTypeSchema = z.enum(['test', 'production']);

export const apiPermissionSchema = z.enum([
  'subscriptions:read',
  'subscriptions:write',
  'payments:read',
  'payments:write',
  'webhooks:read',
  'webhooks:write',
  'analytics:read',
  'users:read',
  'users:write',
  'sandbox:manage',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Developer actions
// ─────────────────────────────────────────────────────────────────────────────

export const registerDeveloperSchema = z.object({
  email: z.string().email('A valid email is required'),
  name: z.string().min(1, 'Name is required'),
  company: z.string().optional(),
});

export const verifyEmailSchema = z.object({
  developerId: developerIdSchema,
  token: z.string().min(1, 'Verification token is required'),
});

export const completeOnboardingSchema = z.object({
  developerId: developerIdSchema,
});

export const getDeveloperSchema = z.object({
  developerId: developerIdSchema,
});

export const updateDeveloperSchema = z.object({
  developerId: developerIdSchema,
  name: z.string().min(1).optional(),
  company: z.string().optional(),
  tier: z.enum(['free', 'pro', 'enterprise']).optional(),
  status: z.enum(['pending', 'active', 'suspended', 'banned']).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// API key actions
// ─────────────────────────────────────────────────────────────────────────────

export const createApiKeySchema = z.object({
  developerId: developerIdSchema,
  name: z.string().min(1, 'Key name is required'),
  type: apiKeyTypeSchema,
  permissions: z.array(apiPermissionSchema).min(1, 'At least one permission is required'),
  /** Key lifetime; defaults to the tier maximum (see utils/apiKeyScopes.ts). */
  expiresInDays: z.number().int().min(1).max(365).optional(),
  /** IPv4 addresses or CIDR ranges allowed to use the key. */
  ipAllowlist: z.array(z.string().min(1)).max(20).optional(),
});

export const revokeApiKeySchema = z.object({
  developerId: developerIdSchema,
  apiKeyId: apiKeyIdSchema,
});

export const rotateApiKeySchema = z.object({
  apiKeyId: apiKeyIdSchema,
  gracePeriodMs: z.number().int().positive().optional(),
  reason: z.string().max(500).optional(),
});

export const getApiKeysSchema = z.object({
  developerId: developerIdSchema,
});

// ─────────────────────────────────────────────────────────────────────────────
// Usage actions
// ─────────────────────────────────────────────────────────────────────────────

export const getUsageMetricsSchema = z.object({
  developerId: developerIdSchema,
});

export const trackUsageSchema = z.object({
  developerId: developerIdSchema,
  endpoint: z.string().min(1, 'Endpoint is required'),
  method: z.string().min(1, 'HTTP method is required'),
  responseTime: z.number().int().min(0, 'Response time must be non-negative'),
  success: z.boolean(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard actions
// ─────────────────────────────────────────────────────────────────────────────

export const getDashboardSchema = z.object({
  developerId: developerIdSchema,
});

// ─────────────────────────────────────────────────────────────────────────────
// Documentation actions
// ─────────────────────────────────────────────────────────────────────────────

export const getDocumentationSchema = z.object({
  category: z.string().optional(),
});

export const searchDocumentationSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
});

export const getArticleSchema = z.object({
  slug: z.string().min(1, 'Article slug is required'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration guide actions
// ─────────────────────────────────────────────────────────────────────────────

export const getIntegrationGuidesSchema = z.object({
  platform: z.string().optional(),
});

export const getIntegrationGuideSchema = z.object({
  guideId: z.string().min(1, 'Guide ID is required'),
});
