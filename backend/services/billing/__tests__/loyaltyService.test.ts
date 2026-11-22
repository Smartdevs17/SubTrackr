import { LoyaltyService } from '../loyaltyService';
import { LOYALTY_REWARDS, LOYALTY_TIERS, resolveLoyaltyTier } from '../loyaltyRewards';

describe('subscriber loyalty rewards', () => {
  it('awards points for subscription charges and upgrades tiers', () => {
    const service = new LoyaltyService();

    const first = service.awardPoints('member_1', 'subscription_charge', { chargeAmount: 50 });
    const second = service.awardPoints('member_1', 'subscription_charge', { chargeAmount: 100 });

    expect(first.accepted).toBe(true);
    expect(first.balance.points).toBe(500);
    expect(second.balance.points).toBe(2500);
    expect(second.tierChanged).toBe(true);
    expect(second.balance.tier).toBe('silver');
    expect(service.getTier('member_1')).toBe('silver');
  });

  it('redeems rewards only when enough points are available', () => {
    const service = new LoyaltyService();
    service.awardPoints('member_2', 'referral');

    const redeemed = service.redeemReward('member_2', 'discount_5');
    const rejected = service.redeemReward('member_2', 'free_month');

    expect(redeemed.accepted).toBe(true);
    expect(redeemed.balance.points).toBe(0);
    expect(rejected.accepted).toBe(false);
    expect(rejected.error).toMatch(/Insufficient points/);
  });

  it('tracks expirations and notifications', () => {
    const service = new LoyaltyService();
    service.awardPoints('member_3', 'referral');

    const expired = service.expirePoints('member_3', 100, 'annual_cleanup');

    expect(expired.accepted).toBe(true);
    expect(expired.balance.expiredPoints).toBe(100);
    expect(expired.balance.points).toBe(400);
    expect(service.getPointsHistory('member_3')).toHaveLength(2);
    expect(service.getNotifications('member_3').length).toBeGreaterThan(0);
  });

  it('exposes the canonical catalog and tier thresholds', () => {
    const service = new LoyaltyService();

    expect(service.getRewards()).toEqual(LOYALTY_REWARDS);
    expect(service.getTiers()).toEqual(LOYALTY_TIERS);
    expect(resolveLoyaltyTier(15_000).id).toBe('platinum');
  });
});
