import {
  RenewalPreflightError,
  createConsoleRenewalTelemetry,
  createHttpChurnPreflightClient,
  createRenewalService,
  deriveIdempotencyKey,
  nextAttempt,
  normalizeDecision,
  shouldAutoRenew,
  validateCandidate,
  type RenewalCandidate,
  type RenewalDecision,
} from '../renewal';

const CANDIDATE: RenewalCandidate = {
  subscriptionId: 'sub-1',
  subscriber: '0xABC',
  renewalAt: '2026-11-25T00:00:00.000Z',
  amountMinor: 1999,
  currency: 'USD',
  features: { recentPaymentFailures: 1, priceSensitivityIndex: 0.7 },
};

const DECISION_BODY = {
  subscription_id: 'sub-1',
  subscriber: '0xABC',
  action: 'defer',
  reason: 'HIGH_RISK',
  risk_level: 'high',
  churn_probability: 0.82,
  model_version: 'v1.1',
  idempotency_key: 'key-1',
  evaluated_at: '2026-11-20T12:00:00.000Z',
  retry_after_seconds: 900,
  recommended_action: 'Offer a discount',
};

function decision(overrides: Partial<RenewalDecision> = {}): RenewalDecision {
  return {
    subscriptionId: 'sub-1',
    subscriber: '0xABC',
    action: 'renew',
    reason: 'LOW_RISK',
    riskLevel: 'low',
    churnProbability: 0.1,
    modelVersion: 'v1.1',
    idempotencyKey: 'key-1',
    evaluatedAt: '2026-11-20T12:00:00.000Z',
    retryAfterSeconds: null,
    recommendedAction: null,
    cacheHit: false,
    ...overrides,
  };
}

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
  };
}

describe('validateCandidate', () => {
  it('accepts a complete candidate', () => {
    expect(() => validateCandidate(CANDIDATE)).not.toThrow();
  });

  it('rejects malformed identity and money fields', () => {
    expect(() => validateCandidate({ ...CANDIDATE, subscriptionId: '  ' })).toThrow(
      RenewalPreflightError,
    );
    expect(() => validateCandidate({ ...CANDIDATE, renewalAt: 'not-a-date' })).toThrow(
      /ISO date/,
    );
    expect(() => validateCandidate({ ...CANDIDATE, amountMinor: 12.5 })).toThrow(/amountMinor/);
    expect(() => validateCandidate({ ...CANDIDATE, currency: 'usd' })).toThrow(/currency/);
  });

  it('rejects out-of-range churn features', () => {
    expect(() =>
      validateCandidate({ ...CANDIDATE, features: { priceSensitivityIndex: 1.5 } }),
    ).toThrow(/priceSensitivityIndex/);
    expect(() =>
      validateCandidate({ ...CANDIDATE, features: { recentLogins: -1 } }),
    ).toThrow(/recentLogins/);
  });
});

describe('normalizeDecision', () => {
  it('maps the snake_case ML response into the backend contract', () => {
    expect(normalizeDecision(DECISION_BODY, CANDIDATE)).toEqual({
      subscriptionId: 'sub-1',
      subscriber: '0xABC',
      action: 'defer',
      reason: 'HIGH_RISK',
      riskLevel: 'high',
      churnProbability: 0.82,
      modelVersion: 'v1.1',
      idempotencyKey: 'key-1',
      evaluatedAt: '2026-11-20T12:00:00.000Z',
      retryAfterSeconds: 900,
      recommendedAction: 'Offer a discount',
      cacheHit: false,
    });
  });

  it('fails closed when the model returns an unknown action', () => {
    const result = normalizeDecision({ action: 'charge-it', churn_probability: 2 }, CANDIDATE);

    expect(result.action).toBe('review');
    expect(result.reason).toBe('UNKNOWN_PREFLIGHT_ACTION');
    expect(result.churnProbability).toBe(1);
    expect(result.idempotencyKey).toBe(deriveIdempotencyKey(CANDIDATE));
  });

  it('rejects a non-object response', () => {
    expect(() => normalizeDecision(null, CANDIDATE)).toThrow(/not an object/);
  });
});

describe('createHttpChurnPreflightClient', () => {
  it('posts a versioned payload with correlation and API headers', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createHttpChurnPreflightClient({
      baseUrl: 'http://ml.test/',
      apiKey: 'secret',
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return okResponse(DECISION_BODY) as never;
      },
      correlationIdFactory: () => 'corr-1',
    });

    const result = await client.evaluate(CANDIDATE);

    expect(result.action).toBe('defer');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://ml.test/v1/churn/renewal/preflight');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-Correlation-ID']).toBe('corr-1');
    expect(headers['X-API-Key']).toBe('secret');
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      subscriptionId: 'sub-1',
      amountMinor: 1999,
      attempt: 1,
      features: { recentPaymentFailures: 1, priceSensitivityIndex: 0.7 },
    });
  });

  it('classifies HTTP and transport failures', async () => {
    const rejected = createHttpChurnPreflightClient({
      baseUrl: 'http://ml.test',
      fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({}) }) as never,
    });
    await expect(rejected.evaluate(CANDIDATE)).rejects.toMatchObject({
      code: 'UPSTREAM_REJECTED',
      retryable: false,
      status: 400,
    });

    const offline = createHttpChurnPreflightClient({
      baseUrl: 'http://ml.test',
      fetchImpl: async () => {
        throw new Error('ENOTFOUND');
      },
    });
    await expect(offline.evaluate(CANDIDATE)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      retryable: true,
    });
  });

  it('flags malformed JSON as a non-retryable response error', async () => {
    const client = createHttpChurnPreflightClient({
      baseUrl: 'http://ml.test',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          throw new Error('bad json');
        },
      }) as never,
    });

    await expect(client.evaluate(CANDIDATE)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      retryable: false,
    });
  });
});

describe('createRenewalService', () => {
  const candidate = CANDIDATE;

  it('returns the ML decision and emits success telemetry', async () => {
    const telemetry = { record: jest.fn() };
    const client = { evaluate: jest.fn().mockResolvedValue(decision()) };
    const service = createRenewalService({ client, telemetry, now: () => 1000 });

    const result = await service.preflight(candidate);

    expect(result.action).toBe('renew');
    expect(client.evaluate).toHaveBeenCalledWith(
      { ...candidate, attempt: 1 },
      { correlationId: expect.stringContaining('renewal-') },
    );
    expect(telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'success', attempts: 1, action: 'renew' }),
    );
  });

  it('retries retryable failures with exponential delays', async () => {
    const attempts: number[] = [];
    const sleeps: number[] = [];
    const client = {
      evaluate: jest.fn().mockImplementation(async () => {
        attempts.push(1);
        if (attempts.length === 1) {
          throw new RenewalPreflightError('UPSTREAM_REJECTED', 'HTTP 503', true, 503);
        }
        return decision({ action: 'review' });
      }),
    };
    const service = createRenewalService({
      client,
      retryDelayMs: 25,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: () => 1000,
    });

    const result = await service.preflight(candidate);

    expect(result.action).toBe('review');
    expect(attempts).toHaveLength(2);
    expect(sleeps).toEqual([25]);
    expect(client.evaluate.mock.calls[1][0].attempt).toBe(2);
  });

  it('fails closed to review after exhausting retries', async () => {
    const telemetry = { record: jest.fn() };
    const client = {
      evaluate: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
    };
    const service = createRenewalService({
      client,
      telemetry,
      maxAttempts: 3,
      retryDelayMs: 5,
      sleep: async () => undefined,
      now: () => 1_700_000_000_000,
    });

    const result = await service.preflight(candidate, { correlationId: 'corr-9' });

    expect(result).toMatchObject({
      action: 'review',
      reason: 'PREFLIGHT_UNAVAILABLE',
      riskLevel: 'unknown',
      retryAfterSeconds: 60,
      idempotencyKey: deriveIdempotencyKey(candidate),
    });
    expect(client.evaluate).toHaveBeenCalledTimes(3);
    expect(telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'degraded',
        errorCode: 'UPSTREAM_UNAVAILABLE',
        attempts: 3,
      }),
    );
  });

  it('does not retry a non-retryable rejection', async () => {
    const telemetry = { record: jest.fn() };
    const client = {
      evaluate: jest.fn().mockRejectedValue(
        new RenewalPreflightError('INVALID_RESPONSE', 'bad payload', false),
      ),
    };
    const service = createRenewalService({ client, telemetry, now: () => 1000 });

    const result = await service.preflight(candidate);

    expect(client.evaluate).toHaveBeenCalledTimes(1);
    expect(result.action).toBe('review');
    expect(telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'degraded',
        errorCode: 'INVALID_RESPONSE',
        attempts: 1,
      }),
    );
  });

  it('validates before calling the upstream client', async () => {
    const client = { evaluate: jest.fn() };
    const service = createRenewalService({ client });

    await expect(service.preflight({ ...candidate, amountMinor: -1 })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(client.evaluate).not.toHaveBeenCalled();
  });
});

describe('renewal helpers', () => {
  it('only auto-renews explicit renew decisions', () => {
    expect(shouldAutoRenew(decision())).toBe(true);
    expect(shouldAutoRenew(decision({ action: 'review' }))).toBe(false);
    expect(shouldAutoRenew(decision({ action: 'defer' }))).toBe(false);
  });

  it('advances the attempt only for decisions that pause renewal', () => {
    expect(nextAttempt(CANDIDATE, decision())).toBe(CANDIDATE);
    expect(nextAttempt(CANDIDATE, decision({ action: 'defer' })).attempt).toBe(2);
    expect(nextAttempt({ ...CANDIDATE, attempt: 4 }, decision({ action: 'block' })).attempt).toBe(5);
  });

  it('provides a console telemetry sink', () => {
    const info = jest.fn();
    const warn = jest.fn();
    const telemetry = createConsoleRenewalTelemetry({ info, warn });

    telemetry.record({
      operation: 'preflight',
      outcome: 'success',
      subscriptionId: 'sub-1',
      correlationId: 'corr-1',
      attempts: 1,
      durationMs: 3,
    });
    telemetry.record({
      operation: 'preflight',
      outcome: 'degraded',
      subscriptionId: 'sub-1',
      correlationId: 'corr-2',
      attempts: 3,
      durationMs: 9,
    });

    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
