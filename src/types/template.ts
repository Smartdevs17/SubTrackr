export interface PricingTier {
  minQuantity: number;
  discountBps: number; // 0-10000 basis points (0% - 100%)
}

export interface PlanTemplate {
  id: string;
  merchant: string;
  name: string;
  basePrice: number;
  billingPeriod: number; // seconds
  tiers: PricingTier[];
  version: number;
  active: boolean;
  createdAt: Date;
}

export interface TemplateFormData {
  name: string;
  basePrice: number;
  billingPeriod: number;
  tiers: PricingTier[];
}

export interface TemplateValidationErrors {
  name?: string;
  basePrice?: string;
  billingPeriod?: string;
  tiers?: string[];
}
