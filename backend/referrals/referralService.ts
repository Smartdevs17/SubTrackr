export interface Referral {
  code: string;
  referrerId: string;
  commissionRate: number;
}

export class ReferralService {
  private referrals: Map<string, Referral> = new Map();
  private commissions: Map<string, number> = new Map();

  createReferralCode(referrerId: string, rate: number = 0.10): string {
    const code = `REF_${referrerId}_${Date.now()}`;
    this.referrals.set(code, {
      code,
      referrerId,
      commissionRate: rate,
    });
    return code;
  }

  processConversion(code: string, purchaseAmount: number): void {
    const referral = this.referrals.get(code);
    if (!referral) return; // No matching code

    const commission = purchaseAmount * referral.commissionRate;
    const current = this.commissions.get(referral.referrerId) || 0;
    this.commissions.set(referral.referrerId, current + commission);
  }

  getCommission(referrerId: string): number {
    return this.commissions.get(referrerId) || 0;
  }
}
