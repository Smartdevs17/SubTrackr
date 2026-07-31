/**
 * Issue #771 – Common Zod Validation Schemas
 *
 * Reusable Zod schemas for all request bodies, query parameters,
 * and path parameters across the SubTrackr API.
 */

import { z } from 'zod';
import { commonSchemas } from './validationMiddleware';

// ── Plan Schemas ─────────────────────────────────────────────────────────────

export const createPlanSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  amount: commonSchemas.amount,
  currency: commonSchemas.currency,
  interval: z.enum(['day', 'week', 'month', 'year']),
  intervalCount: z.number().int().min(1).max(12).default(1),
  trialPeriodDays: z.number().int().min(0).max(365).optional(),
  metadata: commonSchemas.metadata,
  active: z.boolean().default(true),
});

export const updatePlanSchema = createPlanSchema.partial();

export const planQuerySchema = commonSchemas.pagination.extend({
  active: z.coerce.boolean().optional(),
  currency: z.string().length(3).optional(),
  minAmount: z.coerce.number().optional(),
  maxAmount: z.coerce.number().optional(),
});

// ── Subscription Schemas ─────────────────────────────────────────────────────

export const createSubscriptionSchema = z.object({
  customerId: commonSchemas.ethereumAddress,
  planId: commonSchemas.planId,
  paymentMethodId: z.string().min(1),
  trialEnd: commonSchemas.timestamp.optional(),
  metadata: commonSchemas.metadata,
});

export const updateSubscriptionSchema = z.object({
  planId: commonSchemas.planId.optional(),
  paymentMethodId: z.string().min(1).optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
  metadata: commonSchemas.metadata,
});

export const cancelSubscriptionSchema = z.object({
  reason: z.string().max(500).optional(),
  feedback: z.string().max(2000).optional(),
  immediate: z.boolean().default(false),
});

export const pauseSubscriptionSchema = z.object({
  reason: z.string().max(500).optional(),
  resumeAt: commonSchemas.timestamp.optional(),
  pauseDurationDays: z.number().int().min(1).max(365).optional(),
});

export const subscriptionQuerySchema = commonSchemas.pagination.extend({
  status: z.enum(['active', 'paused', 'cancelled', 'past_due', 'trialing']).optional(),
  customerId: commonSchemas.ethereumAddress.optional(),
  planId: commonSchemas.planId.optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'currentPeriodEnd']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ── Payment Schemas ──────────────────────────────────────────────────────────

export const paymentRequestSchema = z.object({
  amount: commonSchemas.amount,
  currency: commonSchemas.currency,
  customerId: commonSchemas.ethereumAddress,
  paymentMethodId: z.string().min(1),
  idempotencyKey: z.string().min(1).max(255),
  metadata: commonSchemas.metadata,
  gatewayPreference: z.enum(['stripe', 'circle', 'stellar']).optional(),
});

export const refundRequestSchema = z.object({
  chargeId: z.string().min(1),
  amount: commonSchemas.amount.optional(),
  reason: z.string().max(500).optional(),
  metadata: commonSchemas.metadata,
});

export const paymentQuerySchema = commonSchemas.pagination.extend({
  customerId: commonSchemas.ethereumAddress.optional(),
  status: z.enum(['succeeded', 'failed', 'pending']).optional(),
  startDate: commonSchemas.timestamp.optional(),
  endDate: commonSchemas.timestamp.optional(),
});

// ── Webhook Schemas ──────────────────────────────────────────────────────────

export const createWebhookSchema = z.object({
  url: z.string().url('Invalid webhook URL'),
  events: z.array(z.string()).min(1, 'At least one event type required'),
  secret: z.string().min(16).max(255).optional(),
  active: z.boolean().default(true),
  metadata: commonSchemas.metadata,
});

// ── API Key Schemas ──────────────────────────────────────────────────────────

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  tier: z.enum(['free', 'basic', 'pro', 'enterprise']).default('free'),
  rateLimit: z.number().int().min(1).max(100000).optional(),
  expiresAt: commonSchemas.timestamp.optional(),
  metadata: commonSchemas.metadata,
});

// ── Analytics Schemas ────────────────────────────────────────────────────────

export const analyticsQuerySchema = z.object({
  startDate: commonSchemas.timestamp.optional(),
  endDate: commonSchemas.timestamp.optional(),
  granularity: z.enum(['hour', 'day', 'week', 'month']).default('day'),
  metrics: z.array(z.enum([
    'revenue',
    'subscribers',
    'churn_rate',
    'mrr',
    'arr',
    'ltv',
    'conversion_rate',
  ])).optional(),
  groupBy: z.enum(['plan', 'currency', 'gateway', 'country']).optional(),
});

export const forecastRequestSchema = z.object({
  horizon: z.number().int().min(1).max(24).default(3),
  granularity: z.enum(['day', 'week', 'month']).default('month'),
  includeConfidence: z.boolean().default(true),
  confidenceLevel: z.number().min(0.5).max(0.99).default(0.95),
});

// ── Customer Schemas ─────────────────────────────────────────────────────────

export const customerQuerySchema = commonSchemas.pagination.extend({
  email: commonSchemas.email.optional(),
  search: commonSchemas.searchQuery,
  sortBy: z.enum(['createdAt', 'totalSpent', 'subscriptionCount']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ── Fallback Chain Schemas ───────────────────────────────────────────────────

export const fallbackChainSchema = z.object({
  merchantId: z.string().min(1),
  chain: z.array(z.object({
    gateway: z.enum(['stripe', 'circle', 'stellar']),
    priority: z.number().int().min(0),
    enabled: z.boolean().default(true),
    timeoutMs: z.number().int().min(100).max(30000).default(5000),
  })).min(2).max(5),
  retryAttempts: z.number().int().min(0).max(5).default(1),
  retryDelayMs: z.number().int().min(100).max(10000).default(1000),
});

export const fallbackQuerySchema = commonSchemas.pagination.extend({
  merchantId: z.string().optional(),
  gateway: z.enum(['stripe', 'circle', 'stellar']).optional(),
  status: z.enum(['success', 'failed', 'timeout']).optional(),
  startDate: commonSchemas.timestamp.optional(),
  endDate: commonSchemas.timestamp.optional(),
});

// ── CORS Schemas ─────────────────────────────────────────────────────────────

export const corsPolicySchema = z.object({
  tenantId: z.string().min(1),
  allowedOrigins: z.array(z.string().url()).min(1),
  allowCredentials: z.boolean().default(false),
  exposedHeaders: z.array(z.string()).optional(),
  maxAge: z.number().int().min(0).max(86400).default(86400),
  allowMethods: z.array(z.enum([
    'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS',
  ])).default(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  allowHeaders: z.array(z.string()).default(['Content-Type', 'Authorization']),
});

// ── Generic ID Param Schema ──────────────────────────────────────────────────

export const idParamSchema = z.object({
  id: commonSchemas.uuid,
});

export const subscriptionIdParamSchema = z.object({
  subscriptionId: commonSchemas.subscriptionId,
});

export const planIdParamSchema = z.object({
  planId: commonSchemas.planId,
});
