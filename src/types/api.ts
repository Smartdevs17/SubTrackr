import { z } from 'zod';

export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z.string().optional(),
    message: z.string().optional(),
  });

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    data: z.array(dataSchema),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
    hasNext: z.boolean(),
    hasPrev: z.boolean(),
  });

export const NotificationPreferencesSchema = z.object({
  pushEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  billingReminders: z.boolean(),
  cryptoUpdates: z.boolean(),
  spendingAlerts: z.boolean(),
});

export const UserProfileSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  avatar: z.string().optional(),
  preferences: NotificationPreferencesSchema,
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
});

export const AppSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  currency: z.string(),
  language: z.string(),
  notifications: NotificationPreferencesSchema,
  privacy: z.object({
    dataSharing: z.boolean(),
    analytics: z.boolean(),
  }),
});

export const ErrorStateSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  details: z.record(z.unknown()).optional(),
  timestamp: z.union([z.string(), z.date()]),
});

export const LoadingStateSchema = z.object({
  isLoading: z.boolean(),
  message: z.string().optional(),
  progress: z.number().optional(),
});

export const SubscriptionCategorySchema = z.enum([
  'streaming',
  'software',
  'gaming',
  'productivity',
  'fitness',
  'education',
  'finance',
  'other',
]);

export const BillingCycleSchema = z.enum(['monthly', 'yearly', 'weekly', 'custom']);

export const SubscriptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  category: SubscriptionCategorySchema,
  price: z.number(),
  currency: z.string(),
  billingCycle: BillingCycleSchema,
  nextBillingDate: z.union([z.string(), z.date()]),
  isActive: z.boolean(),
  notificationsEnabled: z.boolean().optional(),
  isCryptoEnabled: z.boolean(),
  cryptoStreamId: z.string().optional(),
  cryptoToken: z.string().optional(),
  cryptoAmount: z.number().optional(),
  gasBudget: z.number().optional(),
  totalGasSpent: z.number().optional(),
  chargeCount: z.number().optional(),
  lastGasCost: z.number().optional(),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
});

export const SubscriptionStatsSchema = z.object({
  totalActive: z.number(),
  totalMonthlySpend: z.number(),
  totalYearlySpend: z.number(),
  categoryBreakdown: z.record(SubscriptionCategorySchema, z.number()),
  totalGasSpent: z.number().optional(),
});

export const SubscriptionFormDataSchema = SubscriptionSchema.omit({
  id: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  totalGasSpent: true,
  chargeCount: true,
  lastGasCost: true,
  cryptoStreamId: true,
}).partial({
  notificationsEnabled: true,
  description: true,
  cryptoToken: true,
  cryptoAmount: true,
  gasBudget: true,
});

export const TokenBalanceSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  address: z.string(),
  balance: z.string(),
  decimals: z.number(),
  logoURI: z.string().optional(),
});

export const WalletConnectionSchema = z.object({
  address: z.string(),
  chainId: z.number(),
  isConnected: z.boolean(),
  provider: z.unknown().optional(),
  eip1193Provider: z.unknown().optional(),
});

export const CryptoStreamSchema = z.object({
  id: z.string(),
  subscriptionId: z.string(),
  token: z.string(),
  amount: z.number(),
  flowRate: z.string(),
  startDate: z.union([z.string(), z.date()]),
  endDate: z.union([z.string(), z.date()]).optional(),
  isActive: z.boolean(),
  protocol: z.enum(['superfluid', 'sablier']),
  streamId: z.string().optional(),
});

export const StreamSetupSchema = z.object({
  token: z.string(),
  amount: z.number(),
  flowRate: z.string(),
  startDate: z.union([z.string(), z.date()]),
  endDate: z.union([z.string(), z.date()]).optional(),
  protocol: z.enum(['superfluid', 'sablier']),
});

export const GasEstimateSchema = z.object({
  gasLimit: z.string(),
  gasPrice: z.string(),
  estimatedCost: z.string(),
});

export const TransactionSchema = z.object({
  hash: z.string(),
  from: z.string(),
  to: z.string(),
  value: z.string(),
  gasUsed: z.string(),
  gasPrice: z.string(),
  status: z.enum(['pending', 'confirmed', 'failed']),
  timestamp: z.union([z.string(), z.date()]),
});

export const QueuedTransactionPayloadSchema = z.object({
  protocol: z.enum(['superfluid', 'sablier']),
  token: z.string(),
  amount: z.string(),
  recipientAddress: z.string(),
  chainId: z.number(),
  startTime: z.number().optional(),
  stopTime: z.number().optional(),
});

export const QueuedTransactionSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  attempts: z.number(),
  lastAttemptAt: z.number().optional(),
  conflictKey: z.string(),
  status: z.enum(['pending', 'processing']),
  payload: QueuedTransactionPayloadSchema,
  lastError: z.string().optional(),
});

export const SuperfluidStreamResultSchema = z.object({
  txHash: z.string(),
  streamId: z.string(),
});

export const ExecuteOrQueueResultSchema = z.object({
  queued: z.boolean(),
  transactionId: z.string(),
  streamId: z.string().optional(),
  txHash: z.string().optional(),
});

export type ApiResponse<T> = z.infer<ReturnType<typeof ApiResponseSchema>>;
export type PaginatedResponse<T> = z.infer<ReturnType<typeof PaginatedResponseSchema>>;
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;
export type UserProfile = z.infer<typeof UserProfileSchema>;
export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type ErrorState = z.infer<typeof ErrorStateSchema>;
export type LoadingState = z.infer<typeof LoadingStateSchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;
export type SubscriptionStats = z.infer<typeof SubscriptionStatsSchema>;
export type SubscriptionFormData = z.infer<typeof SubscriptionFormDataSchema>;
export type TokenBalance = z.infer<typeof TokenBalanceSchema>;
export type WalletConnection = z.infer<typeof WalletConnectionSchema>;
export type CryptoStream = z.infer<typeof CryptoStreamSchema>;
export type StreamSetup = z.infer<typeof StreamSetupSchema>;
export type GasEstimate = z.infer<typeof GasEstimateSchema>;
export type Transaction = z.infer<typeof TransactionSchema>;
export type QueuedTransactionPayload = z.infer<typeof QueuedTransactionPayloadSchema>;
export type QueuedTransaction = z.infer<typeof QueuedTransactionSchema>;
export type SuperfluidStreamResult = z.infer<typeof SuperfluidStreamResultSchema>;
export type ExecuteOrQueueResult = z.infer<typeof ExecuteOrQueueResultSchema>;
