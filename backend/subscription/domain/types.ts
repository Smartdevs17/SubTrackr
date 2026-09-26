/**
 * Subscription plan metadata domain types.
 */

export interface PlanLimits {
  maxSubscriptions?: number;
  maxUsers?: number;
  maxApiCallsPerMonth?: number;
  storageGb?: number;
}

export interface PlanMetadataConfig {
  /** Per-plan cache TTL override in seconds. */
  cacheTTL?: number;
  [key: string]: unknown;
}

export interface PlanMetadata {
  id: string;
  name: string;
  price: number;
  currency: string;
  billingCycle: string;
  features: string[];
  limits: PlanLimits;
  isActive: boolean;
  metadata: PlanMetadataConfig;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlanInput {
  name: string;
  price: number;
  currency: string;
  billingCycle: string;
  features?: string[];
  limits?: PlanLimits;
  metadata?: PlanMetadataConfig;
}

export interface UpdatePlanInput {
  name?: string;
  price?: number;
  currency?: string;
  billingCycle?: string;
  features?: string[];
  limits?: PlanLimits;
  metadata?: PlanMetadataConfig;
  isActive?: boolean;
}
