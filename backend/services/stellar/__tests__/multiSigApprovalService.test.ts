/**
 * Unit tests for MultiSigApprovalService.
 *
 * Coverage targets (≥ 22 cases):
 *  1.  Charge below threshold → null (no approval needed)
 *  2.  Charge exactly at threshold → pending request created
 *  3.  Charge above threshold → pending request created
 *  4.  2-of-3 config: correct M-of-N stored on request
 *  5.  First approval keeps status 'pending'
 *  6.  Second approval in 2-of-3 → status becomes 'approved'
 *  7.  Third approval is a no-op (already approved)
 *  8.  Same signer approving twice is idempotent (returns already_approved)
 *  9.  Unauthorized signer approval → not_authorized
 * 10.  Authorized signer rejection → status becomes 'rejected'
 * 11.  Rejection on already-approved request → already_resolved
 * 12.  Approval on already-approved request → already_resolved
 * 13.  getApprovalStatus returns correct pending state
 * 14.  getApprovalStatus returns correct approved state
 * 15.  getApprovalStatus returns null for unknown id
 * 16.  isChargeApproved → true for approved charge
 * 17.  isChargeApproved → false for pending charge
 * 18.  isChargeApproved → true for charge below threshold (no request)
 * 19.  isChargeApproved → false for rejected charge
 * 20.  expireStaleRequests marks expired pending requests
 * 21.  Approval on expired request → 'expired' reason
 * 22.  Threshold is per merchant (different merchants have independent configs)
 * 23.  No merchant config throws on initiateApproval
 * 24.  Currency mismatch treated as below threshold
 * 25.  Rejection by unauthorized signer → not_authorized
 */

import {
  MultiSigApprovalService,
  InMemoryMultiSigStore,
  type MerchantMultiSigConfig,
} from '../multiSigApprovalService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MERCHANT_A = 'merchant-a';
const MERCHANT_B = 'merchant-b';

const SIGNERS_A = ['signer-1', 'signer-2', 'signer-3'];
const SIGNERS_B = ['signer-x', 'signer-y'];

const CONFIG_A: MerchantMultiSigConfig = {
  merchantId: MERCHANT_A,
  thresholdAmount: 1000,
  currency: 'XLM',
  requiredApprovals: 2, // 2-of-3
  totalSigners: 3,
  signerAddresses: SIGNERS_A,
};

const CONFIG_B: MerchantMultiSigConfig = {
  merchantId: MERCHANT_B,
  thresholdAmount: 500, // different threshold
  currency: 'XLM',
  requiredApprovals: 1, // 1-of-2
  totalSigners: 2,
  signerAddresses: SIGNERS_B,
};

/** Build a service with a fixed clock tick to keep assertions deterministic. */
function makeService(nowMs = 1_000_000) {
  const store = new InMemoryMultiSigStore();
  let tick = nowMs;
  const clock = () => tick;
  const advanceClock = (ms: number) => {
    tick += ms;
  };
  const service = new MultiSigApprovalService(store, { requestTtlMs: 60_000, now: clock });
  return { service, store, clock, advanceClock };
}

// ─── Test suites ─────────────────────────────────────────────────────────────

describe('MultiSigApprovalService', () => {
  // ── 1. Charge below threshold ───────────────────────────────────────────
  it('(1) returns null when charge amount is strictly below the threshold', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A);

    const result = await service.initiateApproval(MERCHANT_A, 'charge-1', 999, 'XLM');
    expect(result).toBeNull();
  });

  // ── 2. Charge exactly at threshold ─────────────────────────────────────
  it('(2) creates a pending request when charge equals the threshold', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A);

    const request = await service.initiateApproval(MERCHANT_A, 'charge-2', 1000, 'XLM');
    expect(request).not.toBeNull();
    expect(request!.status).toBe('pending');
    expect(request!.chargeId).toBe('charge-2');
  });

  // ── 3. Charge above threshold ───────────────────────────────────────────
  it('(3) creates a pending request when charge exceeds the threshold', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A);

    const request = await service.initiateApproval(MERCHANT_A, 'charge-3', 5000, 'XLM');
    expect(request).not.toBeNull();
    expect(request!.status).toBe('pending');
    expect(request!.amount).toBe(5000);
  });

  // ── 4. 2-of-3 M-of-N stored correctly ──────────────────────────────────
  it('(4) stores the correct M-of-N (2-of-3) from the merchant config', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A);

    const request = await service.initiateApproval(MERCHANT_A, 'charge-4', 2000, 'XLM');
    expect(request).not.toBeNull();
    expect(request!.requiredApprovals).toBe(2);
    expect(request!.approvals).toHaveLength(0);
  });

  // ── 5. First approval keeps status 'pending' ────────────────────────────
  it('(5) first approval in a 2-of-3 scenario leaves status as pending', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A);

    const request = await service.initiateApproval(MERCHANT_A, 'charge-5', 2000, 'XLM');
    const result = await service.submitApproval(request!.id, SIGNERS_A[0]);

    expect(result.approved).toBe(false);
    expect(result.request!.status).toBe('pending');
    expect(result.request!.approvals).toEqual([SIGNERS_A[0]]);
  });

  // ── 6. Second approval in 2-of-3 → approved ────────────────────────────
  it('(6) second approval in a 2-of-3 scenario transitions status to approved', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A);

    const request = await service.initiateApproval(MERCHANT_A, 'charge-6', 2000, 'XLM');
    await service.submitApproval(request!.id, SIGNERS_A[0]);
    const result = await service.submitApproval(request!.id, SIGNERS_A[1]);

    expect(result.approved).toBe(true);
    expect(result.request!.status).toBe('approved');
    expect(result.request!.approvals).toContain(SIGNERS_A[0]);
    expect(result.request!.approvals).toContain(SIGNERS_A[1]);
    expect(result.request!.resolvedAt).toBeDefined();
  });

  // ── 7. Third approval is a no-op on already-approved request ───────────
  it('(7) a third approval on an already-approved request returns already_resolved', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A);

    const request = await service.initiateApproval(MERCHANT_A, 'charge-7', 2000, 'XLM');
    await service.submitApproval(request!.id, SIGNERS_A[0]);
    await service.submitApproval(request!.id, SIGNERS_A[1]);

    const result = await service.submitApproval(request!.id, SIGNERS_A[2]);
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('already_resolved');
  });

  // ── 8. Same signer approving twice is idempotent ────────────────────────
  it('(8) same signer approving twice is idempotent (reason: already_approved)', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A);

    const request = await service.initiateApproval(MERCHANT_A, 'charge-8', 2000, 'XLM');
    await service.submitApproval(request!.id, SIGNERS_A[0]);
    const secondResult = await service.submitApproval(request!.id, SIGNERS_A[0]);

    expect(secondResult.approved).toBe(true);
    expect(secondResult.reason).toBe('already_approved');
    // Approval list should still only have one entry for this signer.
    expect(secondResult.request!.approvals.filter((s) => s === SIGNERS_A[0])).toHaveLength(1);
    // Status still pending (only 1 unique signer, 2 required).
    expect(secondResult.request!.status).toBe('pending');
  });

  // ── 9. Unauthorized signer ──────────────────────────────────────────────
  it('(9) unauthorized signer gets not_authorized', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A);

    const request = await service.initiateApproval(MERCHANT_A, 'charge-9', 2000, 'XLM');
    const result = await service.submitApproval(request!.id, 'rogue-signer');

    expect(result.approved).toBe(false);
    expect(result.reason).toBe('not_authorized');
    expect(result.request!.status).toBe('pending');
  });

  // ── 10. Authorized signer rejection ────────────────────────────────────
  it('(10) authorized signer rejection sets status to rejected', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A);

    const request = await service.initiateApproval(MERCHANT_A, 'charge-10', 2000, 'XLM');
    const result = await service.submitRejection(request!.id, SIGNERS_A[0]);

    expect(result.approved).toBe(false);
    expect(result.request!.status).toBe('rejected');
    expect(result.request!.rejections).toContain(SIGNERS_A[0]);
    expect(result.request!.resolvedAt).toBeDefined();
  });

  // ── 11. Rejection on already-approved request → already_resolved ────────
  it('(11) rejection on an already-approved request returns already_resolved', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A);

    const request = await service.initiateApproval(MERCHANT_A, 'charge-11', 2000, 'XLM');
    await service.submitApproval(request!.id, SIGNERS_A[0]);
    await service.submitApproval(request!.id, SIGNERS_A[1]);

    const result = await service.submitRejection(request!.id, SIGNERS_A[2]);
    expect(result.reason).toBe('already_resolved');
    expect(result.request!.status).toBe('approved');
  });

  // ── 12. Approval on already-approved request → already_resolved ─────────
  it('(12) approval on an already-rejected request returns already_resolved', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A);

    const request = await service.initiateApproval(MERCHANT_A, 'charge-12', 2000, 'XLM');
    await service.submitRejection(request!.id, SIGNERS_A[0]);

    const result = await service.submitApproval(request!.id, SIGNERS_A[1]);
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('already_resolved');
  });

  // ── 13. getApprovalStatus pending state ─────────────────────────────────
  it('(13) getApprovalStatus returns the current pending state', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A);

    const request = await service.initiateApproval(MERCHANT_A, 'charge-13', 2000, 'XLM');
    await service.submitApproval(request!.id, SIGNERS_A[0]);

    const status = await service.getApprovalStatus(request!.id);
    expect(status).not.toBeNull();
    expect(status!.status).toBe('pending');
    expect(status!.approvals).toEqual([SIGNERS_A[0]]);
  });

  // ── 14. getApprovalStatus approved state ────────────────────────────────
  it('(14) getApprovalStatus returns approved state after resolution', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A);

    const request = await service.initiateApproval(MERCHANT_A, 'charge-14', 2000, 'XLM');
    await service.submitApproval(request!.id, SIGNERS_A[0]);
    await service.submitApproval(request!.id, SIGNERS_A[1]);

    const status = await service.getApprovalStatus(request!.id);
    expect(status!.status).toBe('approved');
  });

  // ── 15. getApprovalStatus returns null for unknown id ───────────────────
  it('(15) getApprovalStatus returns null for an unknown request id', async () => {
    const { service } = makeService();
    const status = await service.getApprovalStatus('does-not-exist');
    expect(status).toBeNull();
  });

  // ── 16. isChargeApproved → true for approved charge ─────────────────────
  it('(16) isChargeApproved returns true for an approved charge', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A);

    const request = await service.initiateApproval(MERCHANT_A, 'charge-16', 2000, 'XLM');
    await service.submitApproval(request!.id, SIGNERS_A[0]);
    await service.submitApproval(request!.id, SIGNERS_A[1]);

    expect(await service.isChargeApproved('charge-16')).toBe(true);
  });

  // ── 17. isChargeApproved → false for pending charge ─────────────────────
  it('(17) isChargeApproved returns false when the request is still pending', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A);

    const request = await service.initiateApproval(MERCHANT_A, 'charge-17', 2000, 'XLM');
    await service.submitApproval(request!.id, SIGNERS_A[0]); // only 1 of 2

    expect(await service.isChargeApproved('charge-17')).toBe(false);
  });

  // ── 18. isChargeApproved → true for charge below threshold ──────────────
  it('(18) isChargeApproved returns true when the charge was below threshold (no request)', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A);

    await service.initiateApproval(MERCHANT_A, 'charge-18', 50, 'XLM'); // below threshold → null

    expect(await service.isChargeApproved('charge-18')).toBe(true);
  });

  // ── 19. isChargeApproved → false for rejected charge ────────────────────
  it('(19) isChargeApproved returns false for a rejected charge', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A);

    const request = await service.initiateApproval(MERCHANT_A, 'charge-19', 2000, 'XLM');
    await service.submitRejection(request!.id, SIGNERS_A[0]);

    expect(await service.isChargeApproved('charge-19')).toBe(false);
  });

  // ── 20. expireStaleRequests ──────────────────────────────────────────────
  it('(20) expireStaleRequests marks pending requests whose expiresAt has passed', async () => {
    const { service, advanceClock, clock } = makeService(1_000_000);
    await service.configureMerchant(CONFIG_A);

    // Create a request.
    const request = await service.initiateApproval(MERCHANT_A, 'charge-20', 2000, 'XLM');
    expect(request!.status).toBe('pending');

    // Advance the clock past the TTL (60 s in our setup).
    advanceClock(61_000);
    const now = clock();

    const expired = await service.expireStaleRequests(now);
    expect(expired).toBe(1);

    const status = await service.getApprovalStatus(request!.id);
    expect(status!.status).toBe('expired');
    expect(status!.resolvedAt).toBeDefined();
  });

  // ── 21. Approval on expired request ─────────────────────────────────────
  it('(21) submitting approval on an expired request returns reason expired', async () => {
    const { service, advanceClock, clock } = makeService(1_000_000);
    await service.configureMerchant(CONFIG_A);

    const request = await service.initiateApproval(MERCHANT_A, 'charge-21', 2000, 'XLM');

    // Expire via clock advancement (lazy expiry path in submitApproval).
    advanceClock(61_000);

    const result = await service.submitApproval(request!.id, SIGNERS_A[0]);
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('expired');
    expect(result.request!.status).toBe('expired');
  });

  // ── 22. Threshold is per merchant ───────────────────────────────────────
  it('(22) threshold is per merchant — different thresholds are enforced independently', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A); // threshold 1000 XLM
    await service.configureMerchant(CONFIG_B); // threshold 500 XLM

    // Merchant A: 600 XLM is below their 1000 XLM threshold → no approval.
    const resultA = await service.initiateApproval(MERCHANT_A, 'charge-22a', 600, 'XLM');
    expect(resultA).toBeNull();

    // Merchant B: 600 XLM is above their 500 XLM threshold → approval needed.
    const resultB = await service.initiateApproval(MERCHANT_B, 'charge-22b', 600, 'XLM');
    expect(resultB).not.toBeNull();
    expect(resultB!.status).toBe('pending');
    expect(resultB!.requiredApprovals).toBe(1); // 1-of-2 for merchant B
  });

  // ── 23. No merchant config throws on initiateApproval ───────────────────
  it('(23) initiateApproval throws when merchant config is not registered', async () => {
    const { service } = makeService();

    await expect(
      service.initiateApproval('unknown-merchant', 'charge-23', 2000, 'XLM')
    ).rejects.toThrow("No multi-sig config found for merchant 'unknown-merchant'");
  });

  // ── 24. Currency mismatch treated as below threshold ────────────────────
  it('(24) currency mismatch is treated as below threshold (no approval needed)', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A); // XLM threshold

    // USDC is a different currency than the configured XLM threshold.
    const result = await service.initiateApproval(MERCHANT_A, 'charge-24', 5000, 'USDC');
    expect(result).toBeNull();
  });

  // ── 25. Rejection by unauthorized signer ────────────────────────────────
  it('(25) unauthorized signer rejection returns not_authorized and does not change status', async () => {
    const { service } = makeService();
    await service.configureMerchant(CONFIG_A);

    const request = await service.initiateApproval(MERCHANT_A, 'charge-25', 2000, 'XLM');
    const result = await service.submitRejection(request!.id, 'rogue-signer');

    expect(result.approved).toBe(false);
    expect(result.reason).toBe('not_authorized');
    expect(result.request!.status).toBe('pending'); // still pending
  });
});

// ─── InMemoryMultiSigStore ────────────────────────────────────────────────────

describe('InMemoryMultiSigStore', () => {
  it('returns null for unknown request id', async () => {
    const store = new InMemoryMultiSigStore();
    expect(await store.getRequest('nope')).toBeNull();
  });

  it('returns null for unknown chargeId', async () => {
    const store = new InMemoryMultiSigStore();
    expect(await store.getRequestByChargeId('nope')).toBeNull();
  });

  it('returns null for unknown merchantId', async () => {
    const store = new InMemoryMultiSigStore();
    expect(await store.getMerchantConfig('nope')).toBeNull();
  });

  it('can save and retrieve a config', async () => {
    const store = new InMemoryMultiSigStore();
    await store.saveMerchantConfig(CONFIG_A);
    const cfg = await store.getMerchantConfig(MERCHANT_A);
    expect(cfg).not.toBeNull();
    expect(cfg!.thresholdAmount).toBe(1000);
  });
});
