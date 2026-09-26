import { z } from 'zod';

export const TrialStatusSchema = z.enum([
  'active',
  'extended',
  'converted',
  'expired',
  'cancelled',
]);

export const TrialConversionTriggerSchema = z.enum([
  'automatic_time_based',
  'feature_usage_threshold',
  'discount_incentive',
  'manual_upgrade',
]);

export const TrialExtensionRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  extensionDays: z.number().default(7),
  condition: z.enum(['high_engagement', 'inactive_reminder', 'support_ticket', 'promo_offer']),
  isEnabled: z.boolean().default(true),
});

export const TrialRecordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  planId: z.string(),
  status: TrialStatusSchema,
  startDate: z.union([z.string(), z.date()]),
  endDate: z.union([z.string(), z.date()]),
  originalEndDate: z.union([z.string(), z.date()]),
  extensionsGranted: z.number().default(0),
  convertedAt: z.union([z.string(), z.date()]).optional(),
  conversionTrigger: TrialConversionTriggerSchema.optional(),
  engagementScore: z.number().default(50), // 0 to 100
});

export const TrialNotificationTemplateSchema = z.object({
  id: z.string(),
  title: z.string(),
  message: z.string(),
  daysBeforeExpiration: z.number(),
  incentiveDiscountPercent: z.number().optional(),
});

export const TrialAnalyticsSummarySchema = z.object({
  totalTrialsStarted: z.number(),
  activeTrialsCount: z.number(),
  convertedTrialsCount: z.number(),
  trialConversionRate: z.number(), // percentage
  averageTrialDurationDays: z.number(),
  revenueFromConversions: z.number(),
  extendedTrialsCount: z.number(),
});

export type TrialStatus = z.infer<typeof TrialStatusSchema>;
export type TrialConversionTrigger = z.infer<typeof TrialConversionTriggerSchema>;
export type TrialExtensionRule = z.infer<typeof TrialExtensionRuleSchema>;
export type TrialRecord = z.infer<typeof TrialRecordSchema>;
export type TrialNotificationTemplate = z.infer<typeof TrialNotificationTemplateSchema>;
export type TrialAnalyticsSummary = z.infer<typeof TrialAnalyticsSummarySchema>;
