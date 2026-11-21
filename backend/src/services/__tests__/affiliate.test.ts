/**
 * backend/src/services/__tests__/affiliate.test.ts
 *
 * Comprehensive unit tests for AffiliateService.
 */

import {
  AffiliateError,
  AffiliateService,
  InMemoryAffiliateRepository,
  StructuredAffiliateTelemetry,
  type AffiliateProgram,
} from '../affiliate';

const PROGRAM_BASIC: AffiliateProgram = {
  id: 'prog_basic',
  name: 'Basic Referral Program',
  description: '15% commission on first-year payments',
  ratePercent: 15,
  cookieWindowDays: 30,
  paymentThresholdMinor: 5000, // $50.00
  isActive: true,
};

describe('AffiliateService', () => {
  let repo: InMemoryAffiliateRepository;
  let telemetry: StructuredAffiliateTelemetry;
  let service: AffiliateService;
  let clockTime: number;

  beforeEach(async () => {
    repo = new InMemoryAffiliateRepository();
    telemetry = new StructuredAffiliateTelemetry();
    clockTime = 1_700_000_000_000;
    service = new AffiliateService({
      repository: repo,
      metrics: telemetry,
      now: () => new Date(clockTime),
    });

    await service.registerProgram(PROGRAM_BASIC);
  });

  describe('Affiliate Registration', () => {
    it('registers an affiliate with clean referral code and active status', async () => {
      const aff = await service.registerAffiliate('0xWALLET_ALICE', 'prog_basic', 'ALICE15');
      expect(aff.referralCode).toBe('ALICE15');
      expect(aff.status).toBe('active');
      expect(aff.ratePercent).toBe(15);
      expect(aff.paymentThresholdMinor).toBe(5000);
      expect(aff.referralLink).toContain('ALICE15');
    });

    it('returns existing affiliate record when address is already registered', async () => {
      const a1 = await service.registerAffiliate('0xWALLET_BOB', 'prog_basic');
      const a2 = await service.registerAffiliate('0xWALLET_BOB', 'prog_basic');
      expect(a1.id).toBe(a2.id);
    });
  });

  describe('Click Tracking and Flood Rate Limiting', () => {
    it('tracks referral clicks and increments clicks count', async () => {
      const aff = await service.registerAffiliate('0xWALLET_CAROL', 'prog_basic', 'CAROL');
      const click = await service.trackClick('CAROL', '192.168.1.1', 'Mozilla/5.0');

      expect(click.affiliateId).toBe(aff.id);
      expect(click.referralCode).toBe('CAROL');

      const updated = await repo.getAffiliate(aff.id);
      expect(updated?.clicksCount).toBe(1);

      const metrics = telemetry.getSnapshot();
      expect(metrics.clicks).toBe(1);
    });

    it('detects click flooding and suspends affiliate on exceeding rate threshold', async () => {
      const aff = await service.registerAffiliate('0xWALLET_DAVE', 'prog_basic', 'DAVE');

      // Send 14 clicks - valid
      for (let i = 0; i < 14; i++) {
        await service.trackClick('DAVE', '10.0.0.99', 'Bot/1.0');
      }

      // 15th click should trigger flood limit and raise risk score
      await expect(service.trackClick('DAVE', '10.0.0.99', 'Bot/1.0')).rejects.toThrow(
        AffiliateError
      );

      const updated = await repo.getAffiliate(aff.id);
      expect(updated?.fraudRiskScore).toBeGreaterThan(0);
      expect(updated?.fraudStatus).toBe('suspicious');

      const metrics = telemetry.getSnapshot();
      expect(metrics.fraudFlags).toBe(1);
    });
  });

  describe('Multi-Touch Attribution', () => {
    it('evaluates last-touch attribution by default', async () => {
      await service.registerAffiliate('0xAFF_1', 'prog_basic', 'REF1');
      await service.registerAffiliate('0xAFF_2', 'prog_basic', 'REF2');

      clockTime = 1_700_000_010_000;
      await service.trackClick('REF1', '192.168.1.5', 'Mobile Safari');

      clockTime = 1_700_000_020_000;
      await service.trackClick('REF2', '192.168.1.5', 'Mobile Safari');

      const attributions = await service.getAttributedAffiliates({
        subscriptionId: 'sub_100',
        amountMinor: 10000,
        subscriberAddress: '0xBUYER',
        userIp: '192.168.1.5',
        userAgent: 'Mobile Safari',
      });

      expect(attributions).toHaveLength(1);
      const aff2 = await repo.getAffiliateByCode('REF2');
      expect(attributions[0].affiliateId).toBe(aff2?.id);
      expect(attributions[0].touchWeight).toBe(1.0);
    });

    it('evaluates linear attribution equally across unique touchpoints', async () => {
      const a1 = await service.registerAffiliate('0xAFF_A', 'prog_basic', 'REFA');
      const a2 = await service.registerAffiliate('0xAFF_B', 'prog_basic', 'REFB');

      await service.trackClick('REFA', '192.168.1.6', 'Chrome');
      await service.trackClick('REFB', '192.168.1.6', 'Chrome');

      const attributions = await service.getAttributedAffiliates(
        {
          subscriptionId: 'sub_linear',
          amountMinor: 10000,
          subscriberAddress: '0xBUYER',
          userIp: '192.168.1.6',
          userAgent: 'Chrome',
          attributionModel: 'linear',
        },
        'linear'
      );

      expect(attributions).toHaveLength(2);
      expect(attributions[0].touchWeight).toBe(0.5);
      expect(attributions[1].touchWeight).toBe(0.5);
    });
  });

  describe('Conversions and Commission Lifecycle', () => {
    it('converts referral and allocates correct commission cents', async () => {
      const aff = await service.registerAffiliate('0xAFF_EARNER', 'prog_basic', 'EARN15');
      await service.trackClick('EARN15', '192.168.1.7', 'Firefox');

      const comms = await service.convertReferral({
        subscriptionId: 'sub_convert_1',
        amountMinor: 20000, // $200.00
        subscriberAddress: '0xBUYER_GENUINE',
        userIp: '192.168.1.7',
        userAgent: 'Firefox',
        cookieReferralCode: 'EARN15',
      });

      expect(comms).toHaveLength(1);
      // 15% of $200.00 = $30.00 (3000 cents)
      expect(comms[0].commissionAmountMinor).toBe(3000);
      expect(comms[0].status).toBe('pending');

      const updated = await repo.getAffiliate(aff.id);
      expect(updated?.pendingPayoutMinor).toBe(3000);
      expect(updated?.totalReferrals).toBe(1);

      const metrics = telemetry.getSnapshot();
      expect(metrics.conversions).toBe(1);
      expect(metrics.commissionsMinor).toBe(3000);
    });

    it('enforces conversion idempotency for the same subscription', async () => {
      await service.registerAffiliate('0xAFF_IDEMP', 'prog_basic', 'IDEMP');
      await service.trackClick('IDEMP', '192.168.1.8', 'Safari');

      const candidate = {
        subscriptionId: 'sub_idempotent_order',
        amountMinor: 10000,
        subscriberAddress: '0xBUYER',
        userIp: '192.168.1.8',
        userAgent: 'Safari',
      };

      const c1 = await service.convertReferral(candidate);
      const c2 = await service.convertReferral(candidate);

      expect(c1).toHaveLength(1);
      expect(c2).toHaveLength(1);
      expect(c1[0].id).toBe(c2[0].id);
      expect(telemetry.getSnapshot().conversions).toBe(1);
    });

    it('flags and rejects self-referral attempts', async () => {
      const aff = await service.registerAffiliate('0xSELF_REFERRER', 'prog_basic', 'SELF');
      await service.trackClick('SELF', '192.168.1.9', 'Brave');

      const comms = await service.convertReferral({
        subscriptionId: 'sub_self_ref',
        amountMinor: 10000,
        subscriberAddress: '0xSELF_REFERRER', // Matching address!
        userIp: '192.168.1.9',
        userAgent: 'Brave',
      });

      expect(comms).toHaveLength(0); // Rejected, not credited

      const updated = await repo.getAffiliate(aff.id);
      expect(updated?.fraudStatus).toBe('suspicious');
      expect(updated?.pendingPayoutMinor).toBe(0);

      const metrics = telemetry.getSnapshot();
      expect(metrics.fraudFlags).toBe(1);
    });
  });

  describe('Refund Clawbacks', () => {
    it('claws back commission on subscription refund and decrements balance', async () => {
      const aff = await service.registerAffiliate('0xAFF_REFUND', 'prog_basic', 'REFUND');
      await service.trackClick('REFUND', '192.168.1.10', 'Opera');

      await service.convertReferral({
        subscriptionId: 'sub_refund_target',
        amountMinor: 10000,
        subscriberAddress: '0xBUYER_1',
        userIp: '192.168.1.10',
        userAgent: 'Opera',
      });

      const affBefore = await repo.getAffiliate(aff.id);
      expect(affBefore?.pendingPayoutMinor).toBe(1500);

      const clawed = await service.processRefundClawback('sub_refund_target', 'User chargeback');
      expect(clawed).toHaveLength(1);
      expect(clawed[0].status).toBe('clawed_back');
      expect(clawed[0].clawbackReason).toBe('User chargeback');

      const affAfter = await repo.getAffiliate(aff.id);
      expect(affAfter?.pendingPayoutMinor).toBe(0);

      const metrics = telemetry.getSnapshot();
      expect(metrics.clawbacks).toBe(1);
    });
  });

  describe('Payout Processing', () => {
    it('prevents payout when pending balance is below payment threshold', async () => {
      const aff = await service.registerAffiliate('0xAFF_LOW', 'prog_basic', 'LOW');
      // Threshold is 5000 minor ($50.00). Pending is 0.
      await expect(service.requestPayout(aff.id)).rejects.toThrow(AffiliateError);
    });

    it('processes payout when threshold is met and transitions commissions to paid', async () => {
      const aff = await service.registerAffiliate('0xAFF_HIGH', 'prog_basic', 'HIGH');
      await service.trackClick('HIGH', '192.168.1.12', 'Chrome');

      // Earn $150.00 commission on $1000.00 purchase
      await service.convertReferral({
        subscriptionId: 'sub_big_purchase',
        amountMinor: 100000,
        subscriberAddress: '0xBUYER_ENTERPRISE',
        userIp: '192.168.1.12',
        userAgent: 'Chrome',
      });

      const payout = await service.requestPayout(aff.id);
      expect(payout.amountMinor).toBe(15000); // $150.00
      expect(payout.commissionIds).toHaveLength(1);

      const affAfter = await repo.getAffiliate(aff.id);
      expect(affAfter?.pendingPayoutMinor).toBe(0);

      const commissions = await repo.getCommissions(aff.id);
      expect(commissions[0].status).toBe('paid');

      const metrics = telemetry.getSnapshot();
      expect(metrics.payouts).toBe(1);
    });
  });
});
