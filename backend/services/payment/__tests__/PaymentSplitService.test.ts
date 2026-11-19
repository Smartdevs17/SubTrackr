/**
 * Tests for PaymentSplitService (Issue #1720 – cross-account payment splitting).
 *
 * Covers:
 *   - validateSplits: valid splits, percentage-sum enforcement, edge cases
 *   - splitAmount: allocation arithmetic including last-entry rounding
 *   - PaymentSplitService.split(): happy path, partial failure, all-failure,
 *     idempotency-key derivation, metadata forwarding
 *   - PaymentSplitController.split(): HTTP request parsing, 200 / 207 / 400 / 422 / 500
 */

import type { Request, Response } from 'express';
import {
  PaymentSplitService,
  validateSplits,
  splitAmount,
  type SplitPaymentRequest,
  type PaymentSplitEntry,
} from '../domain/PaymentSplitService';
import { PaymentSplitController } from '../controller/paymentSplitController';
import { PaymentError, PaymentErrorCode } from '../errors';
import type { IPaymentRouter, PaymentRequest, PaymentResult } from '../interfaces';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<PaymentResult> = {}): PaymentResult {
  return {
    id: 'charge_test',
    status: 'succeeded',
    amount: 100,
    currency: 'USD',
    gatewayUsed: 'stripe',
    chargeId: 'charge_test',
    processedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRouter(chargeFn: (req: PaymentRequest) => Promise<PaymentResult>): IPaymentRouter {
  return {
    charge: chargeFn,
    refund: jest.fn(),
    getGateway: jest.fn(),
    registerGateway: jest.fn(),
  };
}

/** Minimal valid two-way split (50 / 50). */
function twoWaySplit(): PaymentSplitEntry[] {
  return [
    { destinationAccountId: 'acct_A', percentage: 50 },
    { destinationAccountId: 'acct_B', percentage: 50 },
  ];
}

function buildRequest(overrides: Partial<SplitPaymentRequest> = {}): SplitPaymentRequest {
  return {
    amount: 200,
    currency: 'USD',
    idempotencyKey: 'idem_key_1',
    splits: twoWaySplit(),
    ...overrides,
  };
}

// ─── validateSplits ───────────────────────────────────────────────────────────

describe('validateSplits', () => {
  it('accepts a valid two-entry split summing to exactly 100', () => {
    expect(() => validateSplits(twoWaySplit())).not.toThrow();
  });

  it('accepts a three-entry split summing to exactly 100', () => {
    const splits: PaymentSplitEntry[] = [
      { destinationAccountId: 'a', percentage: 30 },
      { destinationAccountId: 'b', percentage: 40 },
      { destinationAccountId: 'c', percentage: 30 },
    ];
    expect(() => validateSplits(splits)).not.toThrow();
  });

  it('accepts fractional percentages that sum to 100 within tolerance', () => {
    // 33.33 + 33.33 + 33.34 = 100 exactly.
    const splits: PaymentSplitEntry[] = [
      { destinationAccountId: 'a', percentage: 33.33 },
      { destinationAccountId: 'b', percentage: 33.33 },
      { destinationAccountId: 'c', percentage: 33.34 },
    ];
    expect(() => validateSplits(splits)).not.toThrow();
  });

  it('throws SPLIT_VALIDATION_ERROR when fewer than 2 entries', () => {
    expect(() => validateSplits([{ destinationAccountId: 'a', percentage: 100 }])).toThrow(
      PaymentError,
    );
    try {
      validateSplits([{ destinationAccountId: 'a', percentage: 100 }]);
    } catch (e) {
      expect((e as PaymentError).code).toBe(PaymentErrorCode.SPLIT_VALIDATION_ERROR);
    }
  });

  it('throws SPLIT_VALIDATION_ERROR for an empty array', () => {
    expect(() => validateSplits([])).toThrow(PaymentError);
  });

  it('throws SPLIT_VALIDATION_ERROR when a destinationAccountId is blank', () => {
    expect(() =>
      validateSplits([
        { destinationAccountId: '  ', percentage: 50 },
        { destinationAccountId: 'b', percentage: 50 },
      ]),
    ).toThrow(PaymentError);
  });

  it('throws SPLIT_VALIDATION_ERROR when a percentage is 0', () => {
    expect(() =>
      validateSplits([
        { destinationAccountId: 'a', percentage: 0 },
        { destinationAccountId: 'b', percentage: 100 },
      ]),
    ).toThrow(PaymentError);
  });

  it('throws SPLIT_VALIDATION_ERROR when a percentage is negative', () => {
    expect(() =>
      validateSplits([
        { destinationAccountId: 'a', percentage: -10 },
        { destinationAccountId: 'b', percentage: 110 },
      ]),
    ).toThrow(PaymentError);
  });

  it('throws SPLIT_VALIDATION_ERROR when percentages sum to less than 100', () => {
    expect(() =>
      validateSplits([
        { destinationAccountId: 'a', percentage: 40 },
        { destinationAccountId: 'b', percentage: 40 },
      ]),
    ).toThrow(PaymentError);
  });

  it('throws SPLIT_VALIDATION_ERROR when percentages sum to more than 100', () => {
    expect(() =>
      validateSplits([
        { destinationAccountId: 'a', percentage: 60 },
        { destinationAccountId: 'b', percentage: 60 },
      ]),
    ).toThrow(PaymentError);
  });

  it('includes the actual sum in the error message', () => {
    expect(() =>
      validateSplits([
        { destinationAccountId: 'a', percentage: 30 },
        { destinationAccountId: 'b', percentage: 30 },
      ]),
    ).toThrow('60');
  });
});

// ─── splitAmount ──────────────────────────────────────────────────────────────

describe('splitAmount', () => {
  it('calculates a non-last split to 2 decimal places', () => {
    expect(splitAmount(200, 50, false, 0)).toBe(100);
  });

  it('gives the last entry the remainder to avoid drift', () => {
    // 3-way split of 100: 33.33 + 33.33 = 66.66 allocated; last gets 33.34
    const first = splitAmount(100, 33.33, false, 0);
    const second = splitAmount(100, 33.33, false, first);
    const third = splitAmount(100, 33.34, true, first + second);
    expect(first + second + third).toBeCloseTo(100, 5);
    // Last entry absorbs the penny of drift
    expect(third).toBeCloseTo(33.34, 2);
  });

  it('returns 0 for the last entry when there is no remaining amount', () => {
    // Already allocated 100% of a 100-unit payment
    expect(splitAmount(100, 50, true, 100)).toBe(0);
  });

  it('handles a 1-cent split correctly', () => {
    expect(splitAmount(0.01, 50, false, 0)).toBe(0.01);
  });
});

// ─── PaymentSplitService ──────────────────────────────────────────────────────

describe('PaymentSplitService', () => {
  let chargeRequests: PaymentRequest[];

  beforeEach(() => {
    chargeRequests = [];
  });

  function makeService(
    handler: (req: PaymentRequest) => Promise<PaymentResult> = async (req) =>
      makeResult({ amount: req.amount, currency: req.currency }),
  ): PaymentSplitService {
    return new PaymentSplitService(
      makeRouter(async (req) => {
        chargeRequests.push(req);
        return handler(req);
      }),
    );
  }

  // ── Happy path ─────────────────────────────────────────────────────────────

  describe('successful splits', () => {
    it('returns allSucceeded=true when all splits succeed', async () => {
      const service = makeService();
      const result = await service.split(buildRequest());
      expect(result.allSucceeded).toBe(true);
    });

    it('produces one charge per split entry', async () => {
      const service = makeService();
      const splits: PaymentSplitEntry[] = [
        { destinationAccountId: 'acct_1', percentage: 30 },
        { destinationAccountId: 'acct_2', percentage: 40 },
        { destinationAccountId: 'acct_3', percentage: 30 },
      ];
      await service.split(buildRequest({ amount: 1000, splits }));
      expect(chargeRequests).toHaveLength(3);
    });

    it('distributes the total amount proportionally across all splits', async () => {
      const service = makeService();
      await service.split(buildRequest({ amount: 1000, splits: twoWaySplit() }));
      expect(chargeRequests[0]!.amount).toBe(500);
      expect(chargeRequests[1]!.amount).toBe(500);
    });

    it('ensures amounts sum exactly to total (last-entry remainder adjustment)', async () => {
      const service = makeService();
      const splits: PaymentSplitEntry[] = [
        { destinationAccountId: 'a', percentage: 33.33 },
        { destinationAccountId: 'b', percentage: 33.33 },
        { destinationAccountId: 'c', percentage: 33.34 },
      ];
      await service.split(buildRequest({ amount: 100, splits }));
      const total = chargeRequests.reduce((sum, r) => sum + r.amount, 0);
      expect(total).toBeCloseTo(100, 5);
    });

    it('populates split results with gateway and charge data', async () => {
      const service = makeService(async (req) =>
        makeResult({ chargeId: `ch_${req.customerId}`, gatewayUsed: 'circle', amount: req.amount }),
      );
      const result = await service.split(buildRequest());
      expect(result.splits[0]!.chargeId).toBe('ch_acct_A');
      expect(result.splits[0]!.gatewayUsed).toBe('circle');
    });

    it('reflects the currency from the request in the result', async () => {
      const service = makeService();
      const result = await service.split(buildRequest({ currency: 'XLM' }));
      expect(result.currency).toBe('XLM');
    });

    it('reflects totalAmount from the request in the result', async () => {
      const service = makeService();
      const result = await service.split(buildRequest({ amount: 999 }));
      expect(result.totalAmount).toBe(999);
    });
  });

  // ── Idempotency key derivation ─────────────────────────────────────────────

  describe('idempotency key derivation', () => {
    it('derives per-split idempotency keys from the parent key', async () => {
      const service = makeService();
      await service.split(buildRequest({ idempotencyKey: 'parent_key' }));
      expect(chargeRequests[0]!.idempotencyKey).toBe('parent_key:split:0');
      expect(chargeRequests[1]!.idempotencyKey).toBe('parent_key:split:1');
    });
  });

  // ── Metadata forwarding ────────────────────────────────────────────────────

  describe('metadata and chain forwarding', () => {
    it('forwards chainType to each charge', async () => {
      const service = makeService();
      await service.split(buildRequest({ chainType: 'stellar' }));
      for (const req of chargeRequests) {
        expect(req.chainType).toBe('stellar');
      }
    });

    it('forwards chainId to each charge', async () => {
      const service = makeService();
      await service.split(buildRequest({ chainId: 137 }));
      for (const req of chargeRequests) {
        expect(req.chainId).toBe(137);
      }
    });

    it('forwards metadata to each charge', async () => {
      const service = makeService();
      await service.split(buildRequest({ metadata: { orderId: 'ord_abc' } }));
      for (const req of chargeRequests) {
        expect(req.metadata?.orderId).toBe('ord_abc');
      }
    });

    it('does not attach chainType key when not supplied', async () => {
      const service = makeService();
      await service.split(buildRequest({ chainType: undefined }));
      for (const req of chargeRequests) {
        expect(Object.prototype.hasOwnProperty.call(req, 'chainType')).toBe(false);
      }
    });
  });

  // ── Partial / full failure ─────────────────────────────────────────────────

  describe('failure handling', () => {
    it('continues remaining splits when one fails', async () => {
      let callCount = 0;
      const service = makeService(async (req) => {
        callCount++;
        if (callCount === 1) throw new Error('gateway timeout');
        return makeResult({ amount: req.amount });
      });

      const result = await service.split(buildRequest());
      // Both splits were attempted despite the first one failing
      expect(chargeRequests).toHaveLength(2);
      expect(result.splits[0]!.status).toBe('failed');
      expect(result.splits[1]!.status).toBe('succeeded');
      expect(result.allSucceeded).toBe(false);
    });

    it('captures the error message on a failed split entry', async () => {
      const service = makeService(async () => {
        throw new Error('insufficient funds');
      });
      const result = await service.split(buildRequest());
      expect(result.splits[0]!.errorMessage).toBe('insufficient funds');
    });

    it('returns allSucceeded=false when all splits fail', async () => {
      const service = makeService(async () => {
        throw new Error('all gateways down');
      });
      const result = await service.split(buildRequest());
      expect(result.allSucceeded).toBe(false);
      expect(result.splits.every((s) => s.status === 'failed')).toBe(true);
    });

    it('records the destinationAccountId on failed entries', async () => {
      const service = makeService(async () => {
        throw new Error('fail');
      });
      const result = await service.split(buildRequest());
      expect(result.splits[0]!.destinationAccountId).toBe('acct_A');
    });
  });

  // ── Validation delegation ──────────────────────────────────────────────────

  describe('validation delegation', () => {
    it('throws before charging when percentages do not sum to 100', async () => {
      const service = makeService();
      const badSplits: PaymentSplitEntry[] = [
        { destinationAccountId: 'a', percentage: 30 },
        { destinationAccountId: 'b', percentage: 30 },
      ];
      await expect(service.split(buildRequest({ splits: badSplits }))).rejects.toThrow(PaymentError);
      expect(chargeRequests).toHaveLength(0);
    });

    it('throws before charging when fewer than 2 splits are supplied', async () => {
      const service = makeService();
      await expect(
        service.split(
          buildRequest({
            splits: [{ destinationAccountId: 'a', percentage: 100 }],
          }),
        ),
      ).rejects.toThrow(PaymentError);
      expect(chargeRequests).toHaveLength(0);
    });
  });
});

// ─── PaymentSplitController ───────────────────────────────────────────────────

describe('PaymentSplitController', () => {
  function makeRes(): { statusCode: number; body: unknown; status: jest.Mock; json: jest.Mock } {
    let currentStatusCode = 200;
    let currentBody: unknown = undefined;

    const res = {
      get statusCode() {
        return currentStatusCode;
      },
      get body() {
        return currentBody;
      },
    } as { statusCode: number; body: unknown; status: jest.Mock; json: jest.Mock };

    const jsonMock = jest.fn().mockImplementation((b: unknown) => {
      currentBody = b;
      return res;
    });

    const statusMock = jest.fn().mockImplementation((code: number) => {
      currentStatusCode = code;
      // Return an object that has a json method so chaining works.
      return { json: jsonMock };
    });

    (res as Record<string, unknown>)['status'] = statusMock;
    (res as Record<string, unknown>)['json'] = jsonMock;

    return res as { statusCode: number; body: unknown; status: jest.Mock; json: jest.Mock };
  }

  function makeReq(body: Record<string, unknown> = {}, headers: Record<string, string> = {}): Request {
    return { body, headers } as unknown as Request;
  }

  function makeController(
    handler?: (req: PaymentRequest) => Promise<PaymentResult>,
  ): PaymentSplitController {
    const router = makeRouter(
      handler ??
        (async (req) =>
          makeResult({ amount: req.amount, currency: req.currency, chargeId: `ch_${req.customerId}` })),
    );
    const service = new PaymentSplitService(router);
    return new PaymentSplitController(service);
  }

  const validBody = {
    amount: 300,
    currency: 'USD',
    idempotencyKey: 'ik_ctrl_1',
    splits: [
      { destinationAccountId: 'acct_X', percentage: 60 },
      { destinationAccountId: 'acct_Y', percentage: 40 },
    ],
  };

  // ── 200 OK ─────────────────────────────────────────────────────────────────

  it('returns 200 when all splits succeed', async () => {
    const ctrl = makeController();
    const res = makeRes();
    await ctrl.split(makeReq(validBody), res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect((res.body as { success: boolean }).success).toBe(true);
  });

  it('includes split results in the response data', async () => {
    const ctrl = makeController();
    const res = makeRes();
    await ctrl.split(makeReq(validBody), res as unknown as Response);
    const data = (res.body as { data: { splits: unknown[] } }).data;
    expect(data.splits).toHaveLength(2);
  });

  // ── 207 Multi-Status ───────────────────────────────────────────────────────

  it('returns 207 when at least one split fails', async () => {
    let firstCall = true;
    const ctrl = makeController(async () => {
      if (firstCall) {
        firstCall = false;
        throw new Error('gateway error');
      }
      return makeResult();
    });
    const res = makeRes();
    await ctrl.split(makeReq(validBody), res as unknown as Response);
    expect(res.statusCode).toBe(207);
  });

  // ── 400 / 422 validation rejections ───────────────────────────────────────

  it('returns 400 when amount is missing', async () => {
    const ctrl = makeController();
    const res = makeRes();
    await ctrl.split(makeReq({ ...validBody, amount: undefined }), res as unknown as Response);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when amount is zero', async () => {
    const ctrl = makeController();
    const res = makeRes();
    await ctrl.split(makeReq({ ...validBody, amount: 0 }), res as unknown as Response);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when currency is missing', async () => {
    const ctrl = makeController();
    const res = makeRes();
    await ctrl.split(makeReq({ ...validBody, currency: '' }), res as unknown as Response);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when idempotencyKey is missing', async () => {
    const ctrl = makeController();
    const res = makeRes();
    await ctrl.split(makeReq({ ...validBody, idempotencyKey: '' }), res as unknown as Response);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when splits array is missing', async () => {
    const ctrl = makeController();
    const res = makeRes();
    await ctrl.split(makeReq({ ...validBody, splits: undefined }), res as unknown as Response);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when splits is an empty array', async () => {
    const ctrl = makeController();
    const res = makeRes();
    await ctrl.split(makeReq({ ...validBody, splits: [] }), res as unknown as Response);
    expect(res.statusCode).toBe(400);
  });

  it('returns 422 when split percentages do not sum to 100', async () => {
    const ctrl = makeController();
    const res = makeRes();
    await ctrl.split(
      makeReq({
        ...validBody,
        splits: [
          { destinationAccountId: 'a', percentage: 30 },
          { destinationAccountId: 'b', percentage: 30 },
        ],
      }),
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(422);
  });

  it('returns 422 when fewer than 2 splits are supplied', async () => {
    const ctrl = makeController();
    const res = makeRes();
    await ctrl.split(
      makeReq({
        ...validBody,
        splits: [{ destinationAccountId: 'a', percentage: 100 }],
      }),
      res as unknown as Response,
    );
    expect(res.statusCode).toBe(422);
  });

  // ── 500 internal error ─────────────────────────────────────────────────────

  it('returns 500 on an unexpected internal error', async () => {
    const ctrl = new PaymentSplitController({
      split: async () => {
        throw new TypeError('unexpected');
      },
    } as unknown as PaymentSplitService);
    const res = makeRes();
    await ctrl.split(makeReq(validBody), res as unknown as Response);
    expect(res.statusCode).toBe(500);
  });

  // ── Request-ID propagation ─────────────────────────────────────────────────

  it('echoes the x-request-id header in the response meta', async () => {
    const ctrl = makeController();
    const res = makeRes();
    await ctrl.split(
      makeReq(validBody, { 'x-request-id': 'req-abc-123' }),
      res as unknown as Response,
    );
    const meta = (res.body as { meta: { requestId: string } }).meta;
    expect(meta.requestId).toBe('req-abc-123');
  });
});
