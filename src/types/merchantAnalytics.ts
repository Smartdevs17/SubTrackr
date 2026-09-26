import { z } from 'zod';

export const MerchantRevenueAnalyticsSchema = z.object({
  totalRevenue: z.number(),
  monthlyRecurringRevenue: z.number(), // MRR
  annualRecurringRevenue: z.number(), // ARR
  averageRevenuePerUser: z.number(), // ARPU
  revenueGrowthRate: z.number(), // percentage
  revenueHistory: z.array(
    z.object({
      period: z.string(),
      revenue: z.number(),
      subscriptionsCount: z.number(),
    })
  ),
});

export const MerchantSubscriberAnalyticsSchema = z.object({
  totalSubscribers: z.number(),
  activeSubscribers: z.number(),
  pausedSubscribers: z.number(),
  cancelledSubscribers: z.number(),
  churnRate: z.number(), // percentage
  subscriberGrowthRate: z.number(), // percentage
  subscribersByPlan: z.array(
    z.object({
      planId: z.string(),
      planName: z.string(),
      count: z.number(),
      revenue: z.number(),
    })
  ),
});

export const MerchantInsightSeveritySchema = z.enum(['info', 'warning', 'success', 'critical']);

export const MerchantInsightSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.enum(['revenue', 'retention', 'growth', 'churn']),
  severity: MerchantInsightSeveritySchema,
  actionableRecommendation: z.string().optional(),
  createdAt: z.union([z.string(), z.date()]),
});

export const MerchantReportFilterSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  planId: z.string().optional(),
  period: z.enum(['daily', 'weekly', 'monthly', 'yearly']).default('monthly'),
});

export const MerchantAnalyticsDashboardDataSchema = z.object({
  merchantId: z.string(),
  merchantName: z.string(),
  revenue: MerchantRevenueAnalyticsSchema,
  subscribers: MerchantSubscriberAnalyticsSchema,
  insights: z.array(MerchantInsightSchema),
  generatedAt: z.union([z.string(), z.date()]),
});

export type MerchantRevenueAnalytics = z.infer<typeof MerchantRevenueAnalyticsSchema>;
export type MerchantSubscriberAnalytics = z.infer<typeof MerchantSubscriberAnalyticsSchema>;
export type MerchantInsight = z.infer<typeof MerchantInsightSchema>;
export type MerchantReportFilter = z.infer<typeof MerchantReportFilterSchema>;
export type MerchantAnalyticsDashboardData = z.infer<typeof MerchantAnalyticsDashboardDataSchema>;
