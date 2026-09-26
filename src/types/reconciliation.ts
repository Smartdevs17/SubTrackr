import { z } from 'zod';

export const ReconciliationStatusSchema = z.enum([
  'matched',
  'unmatched',
  'partially_matched',
  'exception',
  'pending',
]);

export const DiscrepancyReasonSchema = z.enum([
  'amount_mismatch',
  'fee_deduction',
  'currency_mismatch',
  'missing_bank_record',
  'missing_subscription_record',
  'timing_delay',
]);

export const ScheduleFrequencySchema = z.enum(['realtime', 'hourly', 'daily', 'weekly', 'monthly']);

export const PaymentRecordSchema = z.object({
  id: z.string(),
  subscriptionId: z.string(),
  amount: z.number(),
  currency: z.string(),
  paymentMethod: z.string(), // e.g. "Stripe", "Soroban", "Superfluid", "PayPal"
  transactionHash: z.string().optional(),
  timestamp: z.union([z.string(), z.date()]),
});

export const BankStatementRecordSchema = z.object({
  id: z.string(),
  statementId: z.string(),
  amount: z.number(),
  currency: z.string(),
  reference: z.string(),
  fees: z.number().default(0),
  timestamp: z.union([z.string(), z.date()]),
});

export const ReconciliationMatchSchema = z.object({
  id: z.string(),
  paymentRecordId: z.string(),
  statementRecordId: z.string().optional(),
  subscriptionId: z.string(),
  status: ReconciliationStatusSchema,
  discrepancyAmount: z.number().default(0),
  discrepancyReason: DiscrepancyReasonSchema.optional(),
  resolutionNotes: z.string().optional(),
  resolvedAt: z.union([z.string(), z.date()]).optional(),
  createdAt: z.union([z.string(), z.date()]),
});

export const ReconciliationScheduleSchema = z.object({
  id: z.string(),
  frequency: ScheduleFrequencySchema,
  isEnabled: z.boolean(),
  lastRunAt: z.union([z.string(), z.date()]).optional(),
  nextRunAt: z.union([z.string(), z.date()]).optional(),
  autoResolveMinorDiscrepancies: z.boolean().default(true),
  minorDiscrepancyThreshold: z.number().default(1.0), // $1.00 tolerance
});

export const ReconciliationSummarySchema = z.object({
  totalProcessed: z.number(),
  matchedCount: z.number(),
  unmatchedCount: z.number(),
  exceptionCount: z.number(),
  matchRatePercentage: z.number(),
  totalDiscrepancyVolume: z.number(),
  lastReconciledAt: z.union([z.string(), z.date()]),
});

export type ReconciliationStatus = z.infer<typeof ReconciliationStatusSchema>;
export type DiscrepancyReason = z.infer<typeof DiscrepancyReasonSchema>;
export type ScheduleFrequency = z.infer<typeof ScheduleFrequencySchema>;
export type PaymentRecord = z.infer<typeof PaymentRecordSchema>;
export type BankStatementRecord = z.infer<typeof BankStatementRecordSchema>;
export type ReconciliationMatch = z.infer<typeof ReconciliationMatchSchema>;
export type ReconciliationSchedule = z.infer<typeof ReconciliationScheduleSchema>;
export type ReconciliationSummary = z.infer<typeof ReconciliationSummarySchema>;
