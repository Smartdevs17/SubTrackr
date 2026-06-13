import { AuditService } from '../shared/auditService';
import type { AuditAction } from '../shared/auditTypes';
import {
  Affiliate,
  AffiliateProgram,
  Commission,
  PayoutRecord,
  AffiliateStatus,
  CommissionType,
} from '../../../src/types/affiliate';

const auditService = new AuditService('affiliate-audit-secret-key');

export interface ReferralClick {
  id: string;
  affiliateId: string;
  referralCode: string;
  ip: string;
  userAgent: string;
  timestamp: Date;
  metadata?: any;
}

export interface AttributionEvent {
  subscriptionId: string;
  affiliateId: string;
  touchWeight: number; // 0.0 to 1.0 for multi-touch
  attributionModel: string;
}

export class AffiliateService {
  private static affiliates: Map<string, Affiliate> = new Map();
  private static programs: Map<string, AffiliateProgram> = new Map();
  private static commissions: Map<string, Commission> = new Map();
  private static clicks: ReferralClick[] = [];
  private static payouts: Map<string, PayoutRecord> = new Map();

  static generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  }

  /**
   * Create or update affiliate programs
   */
  static registerProgram(program: AffiliateProgram): void {
    this.programs.set(program.id, program);
  }

  static getProgram(id: string): AffiliateProgram | undefined {
    return this.programs.get(id);
  }

  static listPrograms(): AffiliateProgram[] {
    return Array.from(this.programs.values());
  }

  /**
   * Register a new affiliate merchant / referrer
   */
  static async registerAffiliate(referrerAddress: string, programId: string): Promise<Affiliate> {
    const program = this.programs.get(programId);
    const referralCode = `REF-${referrerAddress.slice(2, 8).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
    const referralLink = `https://subtrackr.com/join?ref=${referralCode}`;

    const newAffiliate: Affiliate = {
      id: this.generateId(),
      referrerAddress,
      programId,
      commissionRate: program ? program.commissionConfig.rate : 10,
      paymentThreshold: 100, // threshold in USD
      status: AffiliateStatus.ACTIVE,
      totalReferrals: 0,
      totalEarnings: 0,
      pendingPayout: 0,
      createdAt: new Date(),
      referralCode,
      referralLink,
      clicksCount: 0,
      fraudRiskScore: 0,
      fraudStatus: 'safe',
      payoutHistory: [],
    };

    this.affiliates.set(newAffiliate.id, newAffiliate);
    
    auditService.capture(
      'admin.action' as AuditAction,
      'system',
      newAffiliate.id,
      'affiliate',
      { action: 'register', referrerAddress, referralCode }
    );

    return newAffiliate;
  }

  /**
   * Track Referral Clicks
   * Mitigates cookie blocking by saving click metadata (IP, UserAgent) in a server-side list
   * to do fallback fingerprint-based match if cookies are blocked on conversions.
   */
  static async trackClick(referralCode: string, ip: string, userAgent: string, metadata?: any): Promise<void> {
    const affiliate = Array.from(this.affiliates.values()).find(a => a.referralCode === referralCode);
    if (!affiliate) {
      throw new Error('Affiliate not found with code: ' + referralCode);
    }

    if (affiliate.status !== AffiliateStatus.ACTIVE) {
      return; // Ignore inactive affiliates
    }

    // Fraud prevention check - click flooding
    const windowStart = new Date(Date.now() - 60000); // 1 minute window
    const recentClicksCount = this.clicks.filter(c => c.ip === ip && c.timestamp > windowStart).length;
    if (recentClicksCount > 15) {
      affiliate.fraudRiskScore = Math.min(100, (affiliate.fraudRiskScore || 0) + 15);
      if (affiliate.fraudRiskScore > 75) {
        affiliate.fraudStatus = 'flagged';
        affiliate.status = AffiliateStatus.SUSPENDED;
      } else if (affiliate.fraudRiskScore > 40) {
        affiliate.fraudStatus = 'suspicious';
      }
      this.affiliates.set(affiliate.id, affiliate);
      
      auditService.capture(
        'admin.action' as AuditAction,
        'system',
        affiliate.id,
        'affiliate',
        { action: 'fraud_click_flooding_flagged', ip, riskScore: affiliate.fraudRiskScore }
      );
      
      throw new Error('Rate limit exceeded for clicks from this source.');
    }

    const click: ReferralClick = {
      id: this.generateId(),
      affiliateId: affiliate.id,
      referralCode,
      ip,
      userAgent,
      timestamp: new Date(),
      metadata,
    };

    this.clicks.push(click);
    affiliate.clicksCount = (affiliate.clicksCount || 0) + 1;
    this.affiliates.set(affiliate.id, affiliate);

    auditService.capture(
      'admin.action' as AuditAction,
      'system',
      affiliate.id,
      'affiliate',
      { action: 'track_click', referralCode, ip }
    );
  }

  /**
   * Determine the attributed affiliate(s) using a multi-touch attribution model or cookie fallback window
   */
  static getAttributedAffiliates(
    userIp: string,
    userAgent: string,
    cookieReferralCode?: string,
    customAttributionModel: 'first-touch' | 'last-touch' | 'linear' = 'last-touch'
  ): AttributionEvent[] {
    const activeAttribution: AttributionEvent[] = [];

    // Find all valid clicks in the attribution window
    const now = Date.now();
    const validClicks = this.clicks.filter(click => {
      const affiliate = this.affiliates.get(click.affiliateId);
      if (!affiliate) return false;
      const program = this.programs.get(affiliate.programId);
      const attributionWindowDays = program ? program.attributionWindowDays : 30;
      const windowMs = attributionWindowDays * 24 * 60 * 60 * 1000;
      
      // Cookie blocking mitigation: if cookieReferralCode matches OR IP+UserAgent matches
      const isAttributionMatch = 
        (cookieReferralCode && click.referralCode === cookieReferralCode) ||
        (click.ip === userIp && click.userAgent === userAgent);

      return isAttributionMatch && (now - click.timestamp.getTime()) < windowMs;
    });

    if (validClicks.length === 0) {
      return [];
    }

    // Sort by timestamp
    validClicks.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    if (customAttributionModel === 'first-touch') {
      const firstClick = validClicks[0];
      activeAttribution.push({
        subscriptionId: '',
        affiliateId: firstClick.affiliateId,
        touchWeight: 1.0,
        attributionModel: 'first-touch',
      });
    } else if (customAttributionModel === 'linear') {
      // Linear: distribute weight equally among all unique touchpoints
      const uniqueAffiliates = Array.from(new Set(validClicks.map(c => c.affiliateId)));
      const weight = 1.0 / uniqueAffiliates.length;
      uniqueAffiliates.forEach(affId => {
        activeAttribution.push({
          subscriptionId: '',
          affiliateId: affId,
          touchWeight: weight,
          attributionModel: 'linear',
        });
      });
    } else {
      // Default: Last-touch
      const lastClick = validClicks[validClicks.length - 1];
      activeAttribution.push({
        subscriptionId: '',
        affiliateId: lastClick.affiliateId,
        touchWeight: 1.0,
        attributionModel: 'last-touch',
      });
    }

    return activeAttribution;
  }

  /**
   * Track referral conversion and subscription commission.
   * Performs fraud detection: self-referral, same IP/device, conversion speed.
   */
  static async convertReferral(
    subscriptionId: string,
    subscriptionAmount: number,
    userIp: string,
    userAgent: string,
    cookieReferralCode?: string,
    customAttributionModel: 'first-touch' | 'last-touch' | 'linear' = 'last-touch'
  ): Promise<Commission[]> {
    const attributions = this.getAttributedAffiliates(userIp, userAgent, cookieReferralCode, customAttributionModel);
    const createdCommissions: Commission[] = [];

    for (const attr of attributions) {
      const affiliate = this.affiliates.get(attr.affiliateId);
      if (!affiliate || affiliate.status !== AffiliateStatus.ACTIVE) continue;

      // ── Fraud Check 1: Self Referral (Same Address, Device or IP) ──
      const affiliateWallet = affiliate.referrerAddress.toLowerCase();
      // In mock, we check if IP address matches the clicker or if user metadata indicates self
      const affiliateClicks = this.clicks.filter(c => c.affiliateId === affiliate.id);
      const matchedClick = affiliateClicks.find(c => c.ip === userIp);
      
      let fraudRiskInc = 0;
      if (matchedClick && matchedClick.ip === userIp) {
        fraudRiskInc += 35; // Suspicious IP overlap
      }
      
      // Fraud Check 2: Signup speed - Conversion within 5s of click
      if (matchedClick) {
        const diffMs = Date.now() - matchedClick.timestamp.getTime();
        if (diffMs < 5000) {
          fraudRiskInc += 30; // Unnaturally fast conversion
        }
      }

      if (fraudRiskInc > 0) {
        affiliate.fraudRiskScore = Math.min(100, (affiliate.fraudRiskScore || 0) + fraudRiskInc);
        if (affiliate.fraudRiskScore > 70) {
          affiliate.fraudStatus = 'flagged';
          affiliate.status = AffiliateStatus.SUSPENDED;
          
          auditService.capture(
            'admin.action' as AuditAction,
            'system',
            affiliate.id,
            'affiliate',
            { action: 'fraud_self_referral_detected', riskScore: affiliate.fraudRiskScore, subscriptionId }
          );
          
          throw new Error('Transaction blocked due to potential self-referral fraud.');
        } else {
          affiliate.fraudStatus = 'suspicious';
        }
        this.affiliates.set(affiliate.id, affiliate);
      }

      // Calculate commission based on program config and touch attribution weight
      const program = this.programs.get(affiliate.programId);
      let calculatedComm = 0;

      if (program) {
        const config = program.commissionConfig;
        if (config.type === CommissionType.FLAT) {
          calculatedComm = config.rate;
        } else if (config.type === CommissionType.TIERED && config.tierThresholds && config.tierRates) {
          let selectedRate = config.rate;
          for (let i = config.tierThresholds.length - 1; i >= 0; i--) {
            if (subscriptionAmount >= config.tierThresholds[i]) {
              selectedRate = config.tierRates[i];
              break;
            }
          }
          calculatedComm = subscriptionAmount * (selectedRate / 100);
        } else {
          calculatedComm = subscriptionAmount * (config.rate / 100);
        }
      } else {
        calculatedComm = subscriptionAmount * 0.1; // fallback 10%
      }

      // Apply touch attribution weight
      const weightedCommission = Math.round(calculatedComm * attr.touchWeight * 100) / 100;

      const commission: Commission = {
        id: this.generateId(),
        affiliateId: affiliate.id,
        subscriptionId,
        amount: weightedCommission,
        currency: 'USD',
        status: 'pending',
        createdAt: new Date(),
      };

      this.commissions.set(commission.id, commission);
      
      // Update affiliate totals
      affiliate.totalReferrals += 1;
      affiliate.pendingPayout += weightedCommission;
      this.affiliates.set(affiliate.id, affiliate);

      createdCommissions.push(commission);

      auditService.capture(
        'admin.action' as AuditAction,
        'system',
        affiliate.id,
        'affiliate',
        { action: 'earned_commission', amount: weightedCommission, subscriptionId }
      );
    }

    return createdCommissions;
  }

  /**
   * Commission Clawback: Automatically clawback pending/approved commissions on subscription cancellation/refund.
   */
  static async processClawback(subscriptionId: string): Promise<number> {
    let totalClawbacked = 0;
    this.commissions.forEach((comm, commId) => {
      if (comm.subscriptionId === subscriptionId && comm.status !== 'paid' && !comm.isClawbacked) {
        comm.isClawbacked = true;
        comm.status = 'pending'; // Reset status or lock it
        totalClawbacked += comm.amount;

        const affiliate = this.affiliates.get(comm.affiliateId);
        if (affiliate) {
          affiliate.pendingPayout = Math.max(0, affiliate.pendingPayout - comm.amount);
          affiliate.totalEarnings = Math.max(0, affiliate.totalEarnings - comm.amount);
          this.affiliates.set(affiliate.id, affiliate);
        }
        this.commissions.set(commId, comm);

        auditService.capture(
          'admin.action' as AuditAction,
          'system',
          comm.affiliateId,
          'affiliate',
          { action: 'clawback_commission', commissionId: comm.id, amount: comm.amount }
        );
      }
    });
    return totalClawbacked;
  }

  /**
   * Payout Management: request payout of pending/approved commissions
   */
  static async requestPayout(affiliateId: string): Promise<PayoutRecord> {
    const affiliate = this.affiliates.get(affiliateId);
    if (!affiliate) {
      throw new Error('Affiliate not found');
    }

    if (affiliate.status !== AffiliateStatus.ACTIVE) {
      throw new Error('Affiliate status is not active: ' + affiliate.status);
    }

    if (affiliate.pendingPayout < affiliate.paymentThreshold) {
      throw new Error(`Minimum payout threshold not met. Required: $${affiliate.paymentThreshold}`);
    }

    const payoutAmount = affiliate.pendingPayout;
    
    // Reset pending payout, add to total earnings
    affiliate.pendingPayout = 0;
    affiliate.totalEarnings += payoutAmount;

    const payout: PayoutRecord = {
      id: this.generateId(),
      amount: payoutAmount,
      currency: 'USD',
      status: 'paid', // Immediately approve for simulation
      requestedAt: new Date(),
      paidAt: new Date(),
    };

    affiliate.payoutHistory = [...(affiliate.payoutHistory || []), payout];
    this.affiliates.set(affiliate.id, affiliate);

    // Update commissions for this affiliate to 'paid' status
    this.commissions.forEach((comm, id) => {
      if (comm.affiliateId === affiliateId && comm.status === 'pending') {
        comm.status = 'paid';
        comm.paidAt = new Date();
        this.commissions.set(id, comm);
      }
    });

    this.payouts.set(payout.id, payout);

    auditService.capture(
      'admin.action' as AuditAction,
      'system',
      affiliateId,
      'affiliate',
      { action: 'request_payout', amount: payoutAmount }
    );

    return payout;
  }

  static getAffiliate(id: string): Affiliate | undefined {
    return this.affiliates.get(id);
  }

  static getAffiliateByAddress(address: string): Affiliate | undefined {
    return Array.from(this.affiliates.values()).find(a => a.referrerAddress.toLowerCase() === address.toLowerCase());
  }

  static listCommissions(): Commission[] {
    return Array.from(this.commissions.values());
  }
}

// Pre-fill a default program
AffiliateService.registerProgram({
  id: 'default-basic',
  name: 'Basic Affiliate Program',
  description: 'Earn 10% commission on all referrals',
  commissionConfig: {
    type: CommissionType.PERCENTAGE,
    rate: 10,
  },
  attributionWindowDays: 30,
  isActive: true,
  attributionModel: 'last-touch',
});

AffiliateService.registerProgram({
  id: 'default-tiered',
  name: 'Tiered Affiliate Program',
  description: 'Earn up to 15% with tiered rates',
  commissionConfig: {
    type: CommissionType.TIERED,
    rate: 10,
    tierThresholds: [100, 500, 1000],
    tierRates: [10, 12, 15],
  },
  attributionWindowDays: 60,
  isActive: true,
  attributionModel: 'last-touch',
});
