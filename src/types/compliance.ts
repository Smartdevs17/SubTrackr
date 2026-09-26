import { z } from 'zod';

export const ComplianceRuleCategorySchema = z.enum([
  'gdpr_privacy',
  'billing_disclosure',
  'auto_renewal',
  'cancellation_policy',
  'pci_dss_security',
  'crypto_regulatory',
]);

export const ComplianceSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);

export const ComplianceCheckStatusSchema = z.enum(['passed', 'warning', 'failed', 'pending']);

export const ComplianceRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: ComplianceRuleCategorySchema,
  severity: ComplianceSeveritySchema,
  isEnabled: z.boolean(),
  regulatoryFramework: z.string(), // e.g. "GDPR", "California Senate Bill 313", "PCI-DSS v4.0", "EU Consumer Rights Directive"
});

export const ComplianceCheckResultSchema = z.object({
  id: z.string(),
  subscriptionId: z.string(),
  ruleId: z.string(),
  ruleName: z.string(),
  category: ComplianceRuleCategorySchema,
  status: ComplianceCheckStatusSchema,
  severity: ComplianceSeveritySchema,
  details: z.string(),
  remediationSteps: z.string().optional(),
  checkedAt: z.union([z.string(), z.date()]),
});

export const ComplianceAlertSchema = z.object({
  id: z.string(),
  checkId: z.string(),
  subscriptionId: z.string(),
  title: z.string(),
  message: z.string(),
  severity: ComplianceSeveritySchema,
  isAcknowledged: z.boolean(),
  createdAt: z.union([z.string(), z.date()]),
});

export const ComplianceAuditTrailEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  performer: z.string(),
  targetId: z.string(),
  details: z.string(),
  timestamp: z.union([z.string(), z.date()]),
});

export const ComplianceDashboardSummarySchema = z.object({
  overallComplianceScore: z.number(), // 0 to 100
  totalChecksCount: z.number(),
  passedChecksCount: z.number(),
  failedChecksCount: z.number(),
  warningChecksCount: z.number(),
  activeAlertsCount: z.number(),
  lastRunAt: z.union([z.string(), z.date()]),
});

export type ComplianceRuleCategory = z.infer<typeof ComplianceRuleCategorySchema>;
export type ComplianceSeverity = z.infer<typeof ComplianceSeveritySchema>;
export type ComplianceCheckStatus = z.infer<typeof ComplianceCheckStatusSchema>;
export type ComplianceRule = z.infer<typeof ComplianceRuleSchema>;
export type ComplianceCheckResult = z.infer<typeof ComplianceCheckResultSchema>;
export type ComplianceAlert = z.infer<typeof ComplianceAlertSchema>;
export type ComplianceAuditTrailEntry = z.infer<typeof ComplianceAuditTrailEntrySchema>;
export type ComplianceDashboardSummary = z.infer<typeof ComplianceDashboardSummarySchema>;
