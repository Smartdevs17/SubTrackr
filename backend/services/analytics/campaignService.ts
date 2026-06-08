import { AuditService } from '../shared/auditService';
import type { AuditAction } from '../shared/auditTypes';

// Create audit service instance
const auditService = new AuditService('campaign-audit-secret-key');

// Re-export types from frontend types for backend use
export interface Campaign {
  id: string;
  name: string;
  type: string;
  status: string;
  content: any;
  target: any;
  schedule?: any;
  automations?: any[];
  channels: string[];
  budget?: number;
  analytics?: any;
  createdAt: Date;
  updatedAt: Date;
  promotionRule?: PromotionRule;
  targeting?: CampaignTargeting;
  stackingConfig?: StackingConfig;
  couponCodes?: CouponCode[];
  maxRedemptions?: number;
  currentRedemptions?: number;
}

export interface CouponCode {
  id: string;
  code: string;
  campaignId: string;
  maxUses: number;
  usedCount: number;
  maxUsesPerUser: number;
  expiresAt?: Date;
  isActive: boolean;
  createdAt: Date;
}

export interface PromotionRule {
  discountType: string;
  discountValue: number;
  appliesTo: 'plan' | 'subscription' | 'both';
  planIds?: string[];
  segmentIds?: string[];
  minPurchaseAmount?: number;
  maxDiscountAmount?: number;
  firstBillingOnly?: boolean;
}

export interface CampaignTargeting {
  audience: string;
  segmentIds?: string[];
  planIds?: string[];
  isNewCustomerOnly?: boolean;
  minTenureDays?: number;
  maxTenureDays?: number;
  excludedSegmentIds?: string[];
  excludedPlanIds?: string[];
}

export interface StackingConfig {
  rule: string;
  priority: number;
  canStackWithSegmentDiscounts: boolean;
  canStackWithOtherCoupons: boolean;
  maxStackingDepth?: number;
}

export interface CampaignAnalytics {
  campaignId: string;
  totalRecipients: number;
  deliveredCount: number;
  openedCount: number;
  clickedCount: number;
  convertedCount: number;
  revenue: number;
  startDate: Date;
  endDate?: Date;
  couponRedemptions?: number;
  totalDiscountGiven?: number;
  averageOrderValue?: number;
  conversionRate?: number;
  revenueImpact?: number;
  newCustomerAcquisitions?: number;
  dailyMetrics?: {
    date: Date;
    redemptions: number;
    revenue: number;
    discountGiven: number;
  }[];
}

export interface CampaignOverlap {
  campaignId: string;
  overlappingCampaignId: string;
  overlapType: 'plan' | 'segment' | 'audience';
  overlapDetails: string;
  severity: 'warning' | 'error';
}

export interface CouponValidation {
  isValid: boolean;
  campaign?: Campaign;
  coupon?: CouponCode;
  discountAmount?: number;
  finalPrice?: number;
  error?: string;
  warnings?: string[];
}

interface RateLimitEntry {
  attempts: number;
  firstAttempt: Date;
  lastAttempt: Date;
}

/**
 * CampaignService - Manages promotional campaigns, coupon codes, targeting, and analytics
 */
export class CampaignService {
  private static campaigns: Map<string, Campaign> = new Map();
  private static coupons: Map<string, CouponCode> = new Map();
  private static rateLimits: Map<string, RateLimitEntry> = new Map();
  private static readonly RATE_LIMIT_MAX_ATTEMPTS = 10;
  private static readonly RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

  /**
   * Create a new campaign with validation
   */
  static async createCampaign(campaignData: Partial<Campaign>): Promise<Campaign> {
    const id = this.generateId();
    const now = new Date();
    
    // Validate campaign data
    this.validateCampaignData(campaignData);
    
    const campaign: Campaign = {
      id,
      name: campaignData.name || '',
      type: campaignData.type || 'promotional',
      status: campaignData.status || 'draft',
      content: campaignData.content || { title: '', body: '' },
      target: campaignData.target || { segmentIds: [] },
      channels: campaignData.channels || [],
      createdAt: now,
      updatedAt: now,
      promotionRule: campaignData.promotionRule,
      targeting: campaignData.targeting,
      stackingConfig: campaignData.stackingConfig,
      couponCodes: campaignData.couponCodes || [],
      budget: campaignData.budget,
      maxRedemptions: campaignData.maxRedemptions,
      currentRedemptions: 0,
      analytics: {
        campaignId: id,
        totalRecipients: 0,
        deliveredCount: 0,
        openedCount: 0,
        clickedCount: 0,
        convertedCount: 0,
        revenue: 0,
        startDate: now,
        couponRedemptions: 0,
        totalDiscountGiven: 0,
      },
    };

    // Check for overlaps
    const overlaps = this.detectCampaignOverlap(campaign);
    if (overlaps.some(o => o.severity === 'error')) {
      throw new Error('Campaign has conflicting overlaps with existing campaigns');
    }

    this.campaigns.set(id, campaign);
    
    auditService.capture(
      'admin.action' as AuditAction,
      'system',
      id,
      'campaign',
      { action: 'create', name: campaign.name }
    );

    return campaign;
  }

  /**
   * Update an existing campaign
   */
  static async updateCampaign(id: string, updates: Partial<Campaign>): Promise<Campaign> {
    const campaign = this.campaigns.get(id);
    if (!campaign) {
      throw new Error('Campaign not found');
    }

    // Prevent updating completed campaigns
    if (campaign.status === 'completed' || campaign.status === 'expired') {
      throw new Error('Cannot update completed or expired campaigns');
    }

    const updatedCampaign = {
      ...campaign,
      ...updates,
      updatedAt: new Date(),
    };

    // Validate overlaps if targeting or promotion rules changed
    if (updates.targeting || updates.promotionRule) {
      const overlaps = this.detectCampaignOverlap(updatedCampaign);
      if (overlaps.some(o => o.severity === 'error')) {
        throw new Error('Update would create conflicting overlaps');
      }
    }

    this.campaigns.set(id, updatedCampaign);

    auditService.capture(
      'admin.action' as AuditAction,
      'system',
      id,
      'campaign',
      { action: 'update', name: campaign.name }
    );

    return updatedCampaign;
  }

  /**
   * Delete a campaign (soft delete)
   */
  static async deleteCampaign(id: string): Promise<void> {
    const campaign = this.campaigns.get(id);
    if (!campaign) {
      throw new Error('Campaign not found');
    }

    // Deactivate all coupons
    if (campaign.couponCodes) {
      for (const coupon of campaign.couponCodes) {
        coupon.isActive = false;
      }
    }

    this.campaigns.set(id, {
      ...campaign,
      status: 'deleted',
      updatedAt: new Date(),
    });

    auditService.capture(
      'admin.action' as AuditAction,
      'system',
      id,
      'campaign',
      { action: 'delete', name: campaign.name }
    );
  }

  /**
   * Get campaign by ID
   */
  static getCampaignById(id: string): Campaign | undefined {
    return this.campaigns.get(id);
  }

  /**
   * List campaigns with optional filters
   */
  static listCampaigns(filters?: {
    status?: string;
    type?: string;
    limit?: number;
    offset?: number;
  }): Campaign[] {
    let campaigns = Array.from(this.campaigns.values());

    if (filters?.status) {
      campaigns = campaigns.filter(c => c.status === filters.status);
    }

    if (filters?.type) {
      campaigns = campaigns.filter(c => c.type === filters.type);
    }

    const offset = filters?.offset || 0;
    const limit = filters?.limit || 100;

    return campaigns.slice(offset, offset + limit);
  }

  /**
   * Generate coupon codes for a campaign
   */
  static async generateCouponCodes(
    campaignId: string,
    count: number,
    options?: {
      prefix?: string;
      maxUses?: number;
      maxUsesPerUser?: number;
      expiresAt?: Date;
    }
  ): Promise<CouponCode[]> {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) {
      throw new Error('Campaign not found');
    }

    const coupons: CouponCode[] = [];
    const prefix = options?.prefix || 'PROMO';

    for (let i = 0; i < count; i++) {
      const code = this.generateCouponCode(prefix);
      const coupon: CouponCode = {
        id: this.generateId(),
        code,
        campaignId,
        maxUses: options?.maxUses || 100,
        usedCount: 0,
        maxUsesPerUser: options?.maxUsesPerUser || 1,
        expiresAt: options?.expiresAt,
        isActive: true,
        createdAt: new Date(),
      };

      this.coupons.set(code, coupon);
      coupons.push(coupon);
    }

    // Update campaign with new coupons
    campaign.couponCodes = [...(campaign.couponCodes || []), ...coupons];
    campaign.updatedAt = new Date();
    this.campaigns.set(campaignId, campaign);

    auditService.capture(
      'admin.action' as AuditAction,
      'system',
      campaignId,
      'campaign',
      { action: 'generate_coupons', count, name: campaign.name }
    );

    return coupons;
  }

  /**
   * Validate a coupon code
   */
  static async validateCouponCode(code: string, context?: {
    userId?: string;
    planId?: string;
    purchaseAmount?: number;
  }): Promise<CouponValidation> {
    // Rate limiting check
    this.checkRateLimit(code);

    const coupon = this.coupons.get(code);
    
    if (!coupon) {
      return {
        isValid: false,
        error: 'Invalid coupon code',
      };
    }

    if (!coupon.isActive) {
      return {
        isValid: false,
        error: 'Coupon code is no longer active',
      };
    }

    if (coupon.usedCount >= coupon.maxUses) {
      return {
        isValid: false,
        error: 'Coupon code has reached maximum usage limit',
      };
    }

    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      return {
        isValid: false,
        error: 'Coupon code has expired',
      };
    }

    const campaign = this.campaigns.get(coupon.campaignId);
    if (!campaign || campaign.status !== 'active') {
      return {
        isValid: false,
        error: 'Associated campaign is not active',
      };
    }

    // Check targeting rules
    if (campaign.targeting && context) {
      const isEligible = this.evaluateTargeting(campaign.targeting, context);
      if (!isEligible) {
        return {
          isValid: false,
          error: 'You are not eligible for this coupon',
        };
      }
    }

    // Check promotion rules
    if (campaign.promotionRule && context?.purchaseAmount) {
      if (campaign.promotionRule.minPurchaseAmount && 
          context.purchaseAmount < campaign.promotionRule.minPurchaseAmount) {
        return {
          isValid: false,
          error: `Minimum purchase amount of $${campaign.promotionRule.minPurchaseAmount} required`,
        };
      }
    }

    const warnings: string[] = [];
    if (campaign.stackingConfig?.rule === 'no_stacking') {
      warnings.push('This coupon cannot be combined with other offers');
    }

    return {
      isValid: true,
      campaign,
      coupon,
      warnings,
    };
  }

  /**
   * Redeem a coupon code
   */
  static async redeemCouponCode(code: string, context: {
    userId: string;
    subscriptionId: string;
    purchaseAmount: number;
  }): Promise<{ success: boolean; discountAmount: number; finalPrice: number }> {
    const validation = await this.validateCouponCode(code, context);
    
    if (!validation.isValid || !validation.campaign || !validation.coupon) {
      throw new Error(validation.error || 'Coupon validation failed');
    }

    const { campaign, coupon } = validation;
    
    // Calculate discount
    const discountAmount = this.calculateDiscount(
      campaign.promotionRule!,
      context.purchaseAmount
    );

    const finalPrice = context.purchaseAmount - discountAmount;

    // Update coupon usage
    coupon.usedCount += 1;
    this.coupons.set(code, coupon);

    // Update campaign analytics
    if (campaign.analytics) {
      campaign.analytics.couponRedemptions = (campaign.analytics.couponRedemptions || 0) + 1;
      campaign.analytics.totalDiscountGiven = (campaign.analytics.totalDiscountGiven || 0) + discountAmount;
    }
    campaign.currentRedemptions = (campaign.currentRedemptions || 0) + 1;
    campaign.updatedAt = new Date();
    this.campaigns.set(campaign.id, campaign);

    auditService.capture(
      'admin.action' as AuditAction,
      'system',
      campaign.id,
      'campaign',
      { action: 'redeem_coupon', code, userId: context.userId }
    );

    return {
      success: true,
      discountAmount,
      finalPrice: Math.max(0, finalPrice),
    };
  }

  /**
   * Get currently active campaigns
   */
  static getActiveCampaigns(): Campaign[] {
    const now = new Date();
    return Array.from(this.campaigns.values()).filter(campaign => {
      if (campaign.status !== 'active') return false;
      
      // Check schedule
      if (campaign.schedule) {
        const startDate = new Date(campaign.schedule.startDate);
        const endDate = campaign.schedule.endDate ? new Date(campaign.schedule.endDate) : null;
        
        if (now < startDate) return false;
        if (endDate && now > endDate) return false;
      }
      
      // Check budget and redemptions
      if (campaign.budget && campaign.analytics?.totalDiscountGiven) {
        if (campaign.analytics.totalDiscountGiven >= campaign.budget) return false;
      }
      
      if (campaign.maxRedemptions && campaign.currentRedemptions) {
        if (campaign.currentRedemptions >= campaign.maxRedemptions) return false;
      }
      
      return true;
    });
  }

  /**
   * Schedule a campaign
   */
  static async scheduleCampaign(id: string, schedule: {
    startDate: Date;
    endDate?: Date;
  }): Promise<Campaign> {
    const campaign = this.campaigns.get(id);
    if (!campaign) {
      throw new Error('Campaign not found');
    }

    if (schedule.startDate <= new Date()) {
      throw new Error('Start date must be in the future');
    }

    campaign.schedule = schedule;
    campaign.status = 'scheduled';
    campaign.updatedAt = new Date();
    this.campaigns.set(id, campaign);

    auditService.capture(
      'admin.action' as AuditAction,
      'system',
      id,
      'campaign',
      { action: 'schedule', name: campaign.name, schedule }
    );

    return campaign;
  }

  /**
   * Activate scheduled campaigns based on current time
   */
  static async activateScheduledCampaigns(): Promise<string[]> {
    const now = new Date();
    const activated: string[] = [];

    this.campaigns.forEach((campaign, id) => {
      if (campaign.status === 'scheduled' && campaign.schedule) {
        const startDate = new Date(campaign.schedule.startDate);
        if (now >= startDate) {
          campaign.status = 'active';
          campaign.updatedAt = now;
          this.campaigns.set(id, campaign);
          activated.push(id);

          auditService.capture(
            'admin.action' as AuditAction,
            'system',
            id,
            'campaign',
            { action: 'auto_activate', name: campaign.name }
          );
        }
      }
    });

    return activated;
  }

  /**
   * Expire completed campaigns
   */
  static async expireCampaigns(): Promise<string[]> {
    const now = new Date();
    const expired: string[] = [];

    this.campaigns.forEach((campaign, id) => {
      if (campaign.status === 'active' && campaign.schedule?.endDate) {
        const endDate = new Date(campaign.schedule.endDate);
        if (now > endDate) {
          campaign.status = 'completed';
          campaign.updatedAt = now;
          if (campaign.analytics) {
            campaign.analytics.endDate = now;
          }
          this.campaigns.set(id, campaign);
          expired.push(id);

          auditService.capture(
            'admin.action' as AuditAction,
            'system',
            id,
            'campaign',
            { action: 'expire', name: campaign.name }
          );
        }
      }
    });

    return expired;
  }

  /**
   * Evaluate if a user/subscription matches targeting rules
   */
  static evaluateTargeting(
    targeting: CampaignTargeting,
    context: {
      userId?: string;
      planId?: string;
      isNewCustomer?: boolean;
      tenureDays?: number;
      segmentIds?: string[];
    }
  ): boolean {
    // Check audience type
    if (targeting.audience === 'new_customers' && !context.isNewCustomer) {
      return false;
    }

    if (targeting.audience === 'existing_customers' && context.isNewCustomer) {
      return false;
    }

    // Check tenure
    if (targeting.minTenureDays && context.tenureDays !== undefined) {
      if (context.tenureDays < targeting.minTenureDays) return false;
    }

    if (targeting.maxTenureDays && context.tenureDays !== undefined) {
      if (context.tenureDays > targeting.maxTenureDays) return false;
    }

    // Check plan IDs
    if (targeting.planIds && targeting.planIds.length > 0) {
      if (!context.planId || !targeting.planIds.includes(context.planId)) {
        return false;
      }
    }

    // Check segment IDs
    if (targeting.segmentIds && targeting.segmentIds.length > 0) {
      if (!context.segmentIds || 
          !context.segmentIds.some(id => targeting.segmentIds!.includes(id))) {
        return false;
      }
    }

    // Check exclusions
    if (targeting.excludedPlanIds && context.planId) {
      if (targeting.excludedPlanIds.includes(context.planId)) return false;
    }

    if (targeting.excludedSegmentIds && context.segmentIds) {
      if (context.segmentIds.some(id => targeting.excludedSegmentIds!.includes(id))) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get campaigns eligible for a user
   */
  static getEligibleCampaigns(context: {
    userId: string;
    planId?: string;
    isNewCustomer?: boolean;
    tenureDays?: number;
    segmentIds?: string[];
  }): Campaign[] {
    const activeCampaigns = this.getActiveCampaigns();
    
    return activeCampaigns.filter(campaign => {
      if (!campaign.targeting) return true; // No targeting = eligible for all
      return this.evaluateTargeting(campaign.targeting, context);
    });
  }

  /**
   * Calculate final price with stacking logic
   */
  static calculateFinalPrice(
    originalPrice: number,
    campaigns: Campaign[],
    context?: {
      segmentDiscount?: number;
      isFirstBilling?: boolean;
    }
  ): number {
    // Sort campaigns by priority (lower number = higher priority)
    const sortedCampaigns = [...campaigns].sort((a, b) => {
      const priorityA = a.stackingConfig?.priority ?? 999;
      const priorityB = b.stackingConfig?.priority ?? 999;
      return priorityA - priorityB;
    });

    let finalPrice = originalPrice;
    let appliedCount = 0;

    for (const campaign of sortedCampaigns) {
      if (!campaign.promotionRule) continue;

      // Check stacking rules
      if (appliedCount > 0) {
        const stackingConfig = campaign.stackingConfig;
        if (!stackingConfig || stackingConfig.rule === 'no_stacking') {
          continue; // Skip if no stacking allowed
        }

        if (stackingConfig.maxStackingDepth && appliedCount >= stackingConfig.maxStackingDepth) {
          break; // Max stacking depth reached
        }
      }

      // Calculate discount
      const discount = this.calculateDiscount(campaign.promotionRule, finalPrice);
      
      // Apply max discount cap
      if (campaign.promotionRule.maxDiscountAmount) {
        finalPrice -= Math.min(discount, campaign.promotionRule.maxDiscountAmount);
      } else {
        finalPrice -= discount;
      }

      appliedCount++;
    }

    // Apply segment discount if allowed
    if (context?.segmentDiscount && appliedCount > 0) {
      const lastCampaign = sortedCampaigns[sortedCampaigns.length - 1];
      if (lastCampaign?.stackingConfig?.canStackWithSegmentDiscounts) {
        finalPrice -= context.segmentDiscount;
      }
    }

    return Math.max(0, finalPrice);
  }

  /**
   * Detect overlapping campaigns
   */
  static detectCampaignOverlap(campaign: Campaign): CampaignOverlap[] {
    const overlaps: CampaignOverlap[] = [];
    const otherCampaigns = Array.from(this.campaigns.values()).filter(
      c => c.id !== campaign.id && c.status !== 'deleted' && c.status !== 'completed'
    );

    for (const other of otherCampaigns) {
      // Check plan overlap
      if (campaign.promotionRule?.planIds && other.promotionRule?.planIds) {
        const commonPlans = campaign.promotionRule.planIds.filter(planId =>
          other.promotionRule!.planIds!.includes(planId)
        );
        if (commonPlans.length > 0) {
          overlaps.push({
            campaignId: campaign.id,
            overlappingCampaignId: other.id,
            overlapType: 'plan',
            overlapDetails: `Both campaigns apply to plans: ${commonPlans.join(', ')}`,
            severity: 'warning',
          });
        }
      }

      // Check segment overlap
      if (campaign.targeting?.segmentIds && other.targeting?.segmentIds) {
        const commonSegments = campaign.targeting.segmentIds.filter(segId =>
          other.targeting!.segmentIds!.includes(segId)
        );
        if (commonSegments.length > 0) {
          overlaps.push({
            campaignId: campaign.id,
            overlappingCampaignId: other.id,
            overlapType: 'segment',
            overlapDetails: `Both campaigns target segments: ${commonSegments.join(', ')}`,
            severity: 'warning',
          });
        }
      }

      // Check audience overlap
      if (campaign.targeting?.audience && other.targeting?.audience) {
        if (campaign.targeting.audience === other.targeting.audience &&
            campaign.targeting.audience !== 'specific_segments' &&
            campaign.targeting.audience !== 'specific_plans') {
          overlaps.push({
            campaignId: campaign.id,
            overlappingCampaignId: other.id,
            overlapType: 'audience',
            overlapDetails: `Both campaigns target: ${campaign.targeting.audience}`,
            severity: 'warning',
          });
        }
      }
    }

    return overlaps;
  }

  /**
   * Get campaign performance analytics
   */
  static getCampaignPerformance(id: string): CampaignAnalytics | null {
    const campaign = this.campaigns.get(id);
    if (!campaign || !campaign.analytics) return null;

    const analytics = campaign.analytics;
    
    // Calculate derived metrics
    analytics.conversionRate = analytics.totalRecipients > 0
      ? (analytics.convertedCount / analytics.totalRecipients) * 100
      : 0;

    analytics.averageOrderValue = analytics.convertedCount > 0
      ? analytics.revenue / analytics.convertedCount
      : 0;

    analytics.revenueImpact = analytics.revenue - (analytics.totalDiscountGiven || 0);

    return analytics;
  }

  /**
   * Get coupon analytics
   */
  static getCouponAnalytics(campaignId: string): {
    totalCoupons: number;
    activeCoupons: number;
    totalRedemptions: number;
    averageUsesPerCoupon: number;
  } {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign || !campaign.couponCodes) {
      return {
        totalCoupons: 0,
        activeCoupons: 0,
        totalRedemptions: 0,
        averageUsesPerCoupon: 0,
      };
    }

    const coupons = campaign.couponCodes;
    const activeCoupons = coupons.filter(c => c.isActive).length;
    const totalRedemptions = coupons.reduce((sum, c) => sum + c.usedCount, 0);

    return {
      totalCoupons: coupons.length,
      activeCoupons,
      totalRedemptions,
      averageUsesPerCoupon: coupons.length > 0 ? totalRedemptions / coupons.length : 0,
    };
  }

  // Private helper methods

  private static validateCampaignData(data: Partial<Campaign>): void {
    if (!data.name) {
      throw new Error('Campaign name is required');
    }

    if (data.promotionRule) {
      const { discountType, discountValue } = data.promotionRule;
      
      if (discountType === 'percentage' && (discountValue < 0 || discountValue > 100)) {
        throw new Error('Percentage discount must be between 0 and 100');
      }

      if (discountType === 'fixed_amount' && discountValue <= 0) {
        throw new Error('Fixed discount amount must be positive');
      }

      if (discountType === 'free_months' && (discountValue <= 0 || !Number.isInteger(discountValue))) {
        throw new Error('Free months must be a positive integer');
      }
    }
  }

  private static calculateDiscount(rule: PromotionRule, originalPrice: number): number {
    switch (rule.discountType) {
      case 'percentage':
        return originalPrice * (rule.discountValue / 100);
      case 'fixed_amount':
        return rule.discountValue;
      case 'free_months':
        // This would need billing cycle context; return 0 for now
        return 0;
      default:
        return 0;
    }
  }

  private static generateCouponCode(prefix: string): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed similar-looking characters
    const codeLength = 8;
    let code = prefix + '-';
    
    for (let i = 0; i < codeLength; i++) {
      if (i > 0 && i % 4 === 0) {
        code += '-';
      }
      const randomIndex = Math.floor(Math.random() * chars.length);
      code += chars[randomIndex];
    }
    
    return code;
  }

  private static generateId(): string {
    const timestamp = Date.now().toString(36);
    const randomComponent = Math.random().toString(36).substring(2, 8);
    return `${timestamp}-${randomComponent}`;
  }

  private static checkRateLimit(key: string): void {
    const now = new Date();
    const entry = this.rateLimits.get(key);

    if (!entry) {
      this.rateLimits.set(key, {
        attempts: 1,
        firstAttempt: now,
        lastAttempt: now,
      });
      return;
    }

    // Reset if window has passed
    if (now.getTime() - entry.firstAttempt.getTime() > this.RATE_LIMIT_WINDOW_MS) {
      this.rateLimits.set(key, {
        attempts: 1,
        firstAttempt: now,
        lastAttempt: now,
      });
      return;
    }

    // Check if limit exceeded
    if (entry.attempts >= this.RATE_LIMIT_MAX_ATTEMPTS) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }

    // Update entry
    entry.attempts += 1;
    entry.lastAttempt = now;
    this.rateLimits.set(key, entry);
  }
}
