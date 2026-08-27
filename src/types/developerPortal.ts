import { z } from 'zod';

export enum DeveloperStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DEACTIVATED = 'deactivated',
}

export enum ApiKeyStatus {
  ACTIVE = 'active',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
}

export enum ApiKeyPermission {
  READ = 'read',
  WRITE = 'write',
  DELETE = 'delete',
  ADMIN = 'admin',
}

export const DeveloperProfileSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  company: z.string().optional(),
  website: z.string().url().optional(),
  status: z.nativeEnum(DeveloperStatus),
  tier: z.enum(['free', 'basic', 'pro', 'enterprise']).default('free'),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
  lastLoginAt: z.union([z.string(), z.date()]).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const ApiKeySchema = z.object({
  id: z.string(),
  developerId: z.string(),
  name: z.string(),
  key: z.string(),
  prefix: z.string(),
  permissions: z.array(z.nativeEnum(ApiKeyPermission)),
  status: z.nativeEnum(ApiKeyStatus),
  rateLimit: z.number().default(100),
  dailyLimit: z.number().default(10000),
  createdAt: z.union([z.string(), z.date()]),
  expiresAt: z.union([z.string(), z.date()]).optional(),
  lastUsedAt: z.union([z.string(), z.date()]).optional(),
  revokedAt: z.union([z.string(), z.date()]).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const UsageRecordSchema = z.object({
  id: z.string(),
  developerId: z.string(),
  apiKeyId: z.string(),
  endpoint: z.string(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
  statusCode: z.number(),
  responseTime: z.number(),
  timestamp: z.union([z.string(), z.date()]),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const UsageStatsSchema = z.object({
  developerId: z.string(),
  period: z.object({
    start: z.union([z.string(), z.date()]),
    end: z.union([z.string(), z.date()]),
  }),
  totalCalls: z.number(),
  successfulCalls: z.number(),
  failedCalls: z.number(),
  averageResponseTime: z.number(),
  callsByEndpoint: z.record(z.number()),
  callsByStatus: z.record(z.number()),
  callsByDay: z.array(
    z.object({
      date: z.string(),
      count: z.number(),
    })
  ),
  rateLimitHits: z.number(),
  quotaUsed: z.number(),
  quotaLimit: z.number(),
});

export const OnboardingStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  isCompleted: z.boolean(),
  isRequired: z.boolean(),
  order: z.number(),
  action: z.string().optional(),
  link: z.string().optional(),
});

export const DocumentationSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  content: z.string(),
  category: z.string(),
  order: z.number(),
  tags: z.array(z.string()),
  lastUpdated: z.union([z.string(), z.date()]),
});

export const IntegrationGuideSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
  estimatedTime: z.string(),
  prerequisites: z.array(z.string()),
  steps: z.array(
    z.object({
      title: z.string(),
      content: z.string(),
      code: z.string().optional(),
      language: z.string().optional(),
    })
  ),
  tags: z.array(z.string()),
  order: z.number(),
});

export type DeveloperProfile = z.infer<typeof DeveloperProfileSchema>;
export type ApiKey = z.infer<typeof ApiKeySchema>;
export type UsageRecord = z.infer<typeof UsageRecordSchema>;
export type UsageStats = z.infer<typeof UsageStatsSchema>;
export type OnboardingStep = z.infer<typeof OnboardingStepSchema>;
export type DocumentationSection = z.infer<typeof DocumentationSectionSchema>;
export type IntegrationGuide = z.infer<typeof IntegrationGuideSchema>;
