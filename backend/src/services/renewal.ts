/**
 * backend/src/services/renewal.ts
 *
 * Issue #2033 — auto-renewal pre-flight backed by the ML churn probability.
 *
 * The ML service owns the risk policy (`ml-service/churn/`); this module owns
 * everything the billing worker needs: input validation, a typed HTTP client,
 * bounded retries, idempotency, fail-closed behaviour and telemetry. A failure
 * in the ML service therefore never silently becomes a charge — it becomes a
 * `review` decision that a human or the next scheduled attempt can resolve.
 */

// ── Public types ──────────────────────────────────────────────────────────────

export type RenewalAction = 'renew' | 'review' | 'defer' | 'block';

export type RenewalRiskLevel = 'low' | 'medium' | 'high' | 'critical' | 'unknown';

export type RenewalErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'UPSTREAM_REJECTED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'TIMEOUT';

export interface ChurnFeatures {
  recentPaymentFailures?: number;
  baselineLoginsPerMonth?: number;
  recentLogins?: number;
  openSupportTickets?: number;
  priceSensitivityIndex?: number;
}

export interface RenewalCandidate {
  subscriptionId: string;
  subscriber: string;
  renewalAt: string;
  amountMinor: number;
  currency: string;
  attempt?: number;
  paymentMethodAvailable?: boolean;
  paymentMethodExpired?: boolean;
  features?: ChurnFeatures;
}

export interface RenewalDecision {
  subscriptionId: string;
  subscriber: string;
  action: RenewalAction;
  reason: string;
  riskLevel: RenewalRiskLevel;
  churnProbability: number | null;
  modelVersion: string;
  idempotencyKey: string;
  evaluatedAt: string;
  retryAfterSeconds: number | null;
  recommendedAction: string | null;
  cacheHit: boolean;
}

export interface PreflightContext {
  correlationId?: string;
}

export interface ChurnPreflightClient {
  evaluate(
    candidate: RenewalCandidate,
    context?: PreflightContext,
  ): Promise<RenewalDecision>;
}

export class RenewalPreflightError extends Error {
  constructor(
    public readonly code: RenewalErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RenewalPreflightError';
  }
}

// ── Validation & normalisation ────────────────────────────────────────────────

const ACTIONS: RenewalAction[] = ['renew', 'review', 'defer', 'block'];
const RISK_LEVELS: RenewalRiskLevel[] = ['low', 'medium', 'high', 'critical', 'unknown'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

export function validateCandidate(candidate: RenewalCandidate): void {
  if (!isRecord(candidate)) {
    throw new RenewalPreflightError('INVALID_REQUEST', 'A renewal candidate is required');
  }
  if (!candidate.subscriptionId || !candidate.subscriptionId.trim()) {
    throw new RenewalPreflightError('INVALID_REQUEST', 'subscriptionId is required');
  }
  if (!candidate.subscriber || !candidate.subscriber.trim()) {
    throw new RenewalPreflightError('INVALID_REQUEST', 'subscriber is required');
  }
  if (Number.isNaN(Date.parse(candidate.renewalAt))) {
    throw new RenewalPreflightError('INVALID_REQUEST', 'renewalAt must be an ISO date');
  }
  if (!Number.isSafeInteger(candidate.amountMinor) || candidate.amountMinor <= 0) {
    throw new RenewalPreflightError('INVALID_REQUEST', 'amountMinor must be a positive integer');
  }
  if (!/^[A-Z]{3}$/.test(candidate.currency)) {
    throw new RenewalPreflightError('INVALID_REQUEST', 'currency must be an upper-case ISO code');
  }
  if (candidate.attempt !== undefined && (!Number.isSafeInteger(candidate.attempt) || candidate.attempt < 1)) {
    throw new RenewalPreflightError('INVALID_REQUEST', 'attempt must be a positive integer');
  }
  const features = candidate.features ?? {};
  const ranges: Array<[keyof ChurnFeatures, number, number]> = [
    ['recentPaymentFailures', 0, Number.MAX_SAFE_INTEGER],
    ['baselineLoginsPerMonth', 0.0001, Number.MAX_SAFE_INTEGER],
    ['recentLogins', 0, Number.MAX_SAFE_INTEGER],
    ['openSupportTickets', 0, Number.MAX_SAFE_INTEGER],
    ['priceSensitivityIndex', 0, 1],
  ];
  for (const [key, min, max] of ranges) {
    const value = features[key];
    if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) {
      throw new RenewalPreflightError('INVALID_REQUEST', `${key} is outside its allowed range`);
    }
  }
}

/** Deterministic fallback key when an upstream response omits one. */
export function deriveIdempotencyKey(candidate: RenewalCandidate): string {
  const payload = [
    candidate.subscriptionId,
    candidate.renewalAt,
    String(candidate.attempt ?? 1),
  ].join('|');
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `renewal-${(hash >>> 0).toString(16)}`;
}

function asProbability(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function normalizeDecision(
  body: unknown,
  candidate: RenewalCandidate,
): RenewalDecision {
  if (!isRecord(body)) {
    throw new RenewalPreflightError('INVALID_RESPONSE', 'ML pre-flight response is not an object');
  }

  const action = pick(body, 'action', 'decision');
  const riskLevel = pick(body, 'riskLevel', 'risk_level');
  if (typeof action !== 'string' || !ACTIONS.includes(action as RenewalAction)) {
    // Unknown actions are treated as "review" so an upstream model change can
    // never accidentally authorise a charge.
    return {
      subscriptionId: candidate.subscriptionId,
      subscriber: candidate.subscriber,
      action: 'review',
      reason: 'UNKNOWN_PREFLIGHT_ACTION',
      riskLevel: 'unknown',
      churnProbability: asProbability(pick(body, 'churnProbability', 'churn_probability')),
      modelVersion: asNullableString(pick(body, 'modelVersion', 'model_version')) ?? 'unknown',
      idempotencyKey:
        asNullableString(pick(body, 'idempotencyKey', 'idempotency_key')) ??
        deriveIdempotencyKey(candidate),
      evaluatedAt:
        asNullableString(pick(body, 'evaluatedAt', 'evaluated_at')) ?? new Date().toISOString(),
      retryAfterSeconds: null,
      recommendedAction: null,
      cacheHit: false,
    };
  }

  const retryAfter = pick(body, 'retryAfterSeconds', 'retry_after_seconds');
  const evaluatedAt = pick(body, 'evaluatedAt', 'evaluated_at');

  return {
    subscriptionId:
      asNullableString(pick(body, 'subscriptionId', 'subscription_id')) ?? candidate.subscriptionId,
    subscriber: asNullableString(pick(body, 'subscriber')) ?? candidate.subscriber,
    action: action as RenewalAction,
    reason: asNullableString(pick(body, 'reason')) ?? 'UNSPECIFIED',
    riskLevel: RISK_LEVELS.includes(riskLevel as RenewalRiskLevel)
      ? (riskLevel as RenewalRiskLevel)
      : 'unknown',
    churnProbability: asProbability(pick(body, 'churnProbability', 'churn_probability')),
    modelVersion: asNullableString(pick(body, 'modelVersion', 'model_version')) ?? 'unknown',
    idempotencyKey:
      asNullableString(pick(body, 'idempotencyKey', 'idempotency_key')) ??
      deriveIdempotencyKey(candidate),
    evaluatedAt:
      typeof evaluatedAt === 'string' && !Number.isNaN(Date.parse(evaluatedAt))
        ? evaluatedAt
        : new Date().toISOString(),
    retryAfterSeconds:
      typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter >= 0
        ? Math.floor(retryAfter)
        : null,
    recommendedAction: asNullableString(pick(body, 'recommendedAction', 'recommended_action')),
    cacheHit: body.cacheHit === true || body.cache_hit === true,
  };
}

// ── HTTP client ───────────────────────────────────────────────────────────────

export interface HttpChurnPreflightClientOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  correlationIdFactory?: () => string;
}

function defaultCorrelationId(): string {
  return `renewal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createHttpChurnPreflightClient(
  options: HttpChurnPreflightClientOptions,
): ChurnPreflightClient {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const timeoutMs = options.timeoutMs ?? 5000;
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const correlationIdFactory = options.correlationIdFactory ?? defaultCorrelationId;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RenewalPreflightError('INVALID_REQUEST', 'timeoutMs must be positive');
  }

  return {
    async evaluate(candidate, context) {
      validateCandidate(candidate);
      const correlationId = context?.correlationId ?? correlationIdFactory();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(
          `${baseUrl}/v1/churn/renewal/preflight`,
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'X-Correlation-ID': correlationId,
              ...(options.apiKey ? { 'X-API-Key': options.apiKey } : undefined),
            },
            body: JSON.stringify({
              subscriptionId: candidate.subscriptionId,
              subscriber: candidate.subscriber,
              renewalAt: candidate.renewalAt,
              amountMinor: candidate.amountMinor,
              currency: candidate.currency,
              attempt: candidate.attempt ?? 1,
              paymentMethodAvailable: candidate.paymentMethodAvailable ?? true,
              paymentMethodExpired: candidate.paymentMethodExpired ?? false,
              features: {
                recentPaymentFailures: candidate.features?.recentPaymentFailures ?? 0,
                baselineLoginsPerMonth: candidate.features?.baselineLoginsPerMonth ?? 10,
                recentLogins: candidate.features?.recentLogins ?? 10,
                openSupportTickets: candidate.features?.openSupportTickets ?? 0,
                priceSensitivityIndex: candidate.features?.priceSensitivityIndex ?? 0.5,
              },
            }),
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new RenewalPreflightError(
            'UPSTREAM_REJECTED',
            `ML pre-flight returned HTTP ${response.status}`,
            response.status === 429 || response.status >= 500,
            response.status,
          );
        }

        let body: unknown;
        try {
          body = await response.json();
        } catch (error) {
          throw new RenewalPreflightError(
            'INVALID_RESPONSE',
            'ML pre-flight returned invalid JSON',
            false,
            response.status,
            error,
          );
        }
        return normalizeDecision(body, candidate);
      } catch (error) {
        if (error instanceof RenewalPreflightError) throw error;
        if (error instanceof Error && error.name === 'AbortError') {
          throw new RenewalPreflightError('TIMEOUT', 'ML pre-flight timed out', true, undefined, error);
        }
        throw new RenewalPreflightError(
          'UPSTREAM_UNAVAILABLE',
          'Could not reach ML pre-flight service',
          true,
          undefined,
          error,
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ── Service layer ─────────────────────────────────────────────────────────────

export interface RenewalTelemetryEvent {
  operation: 'preflight';
  outcome: 'success' | 'degraded';
  subscriptionId: string;
  correlationId: string;
  attempts: number;
  durationMs: number;
  action?: RenewalAction;
  reason?: string;
  errorCode?: RenewalErrorCode;
}

export interface RenewalTelemetry {
  record(event: RenewalTelemetryEvent): void;
}

export const noopRenewalTelemetry: RenewalTelemetry = {
  record: () => undefined,
};

export function createConsoleRenewalTelemetry(
  logger: Pick<Console, 'info' | 'warn'> = console,
): RenewalTelemetry {
  return {
    record(event) {
      const sink = event.outcome === 'success' ? logger.info : logger.warn;
      sink('[renewal] pre-flight', event);
    },
  };
}

export interface RenewalServiceOptions {
  client: ChurnPreflightClient;
  telemetry?: RenewalTelemetry;
  maxAttempts?: number;
  retryDelayMs?: number;
  correlationIdFactory?: () => string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RenewalService {
  preflight(candidate: RenewalCandidate, context?: PreflightContext): Promise<RenewalDecision>;
}

export function shouldAutoRenew(decision: RenewalDecision): boolean {
  return decision.action === 'renew';
}

export function nextAttempt(
  candidate: RenewalCandidate,
  decision: RenewalDecision,
): RenewalCandidate {
  if (decision.action !== 'defer' && decision.action !== 'block') return candidate;
  return { ...candidate, attempt: (candidate.attempt ?? 1) + 1 };
}

export function createRenewalService(options: RenewalServiceOptions): RenewalService {
  const maxAttempts = options.maxAttempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 200;
  const telemetry = options.telemetry ?? noopRenewalTelemetry;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const correlationIdFactory = options.correlationIdFactory ?? defaultCorrelationId;

  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new RenewalPreflightError('INVALID_REQUEST', 'maxAttempts must be at least 1');
  }

  return {
    async preflight(candidate, context) {
      validateCandidate(candidate);
      const correlationId = context?.correlationId ?? correlationIdFactory();
      const started = now();
      let lastError: RenewalPreflightError | undefined;
      let attempts = 0;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        attempts = attempt;
        try {
          const decision = await options.client.evaluate(
            { ...candidate, attempt: (candidate.attempt ?? 1) + attempt - 1 },
            { correlationId },
          );
          telemetry.record({
            operation: 'preflight',
            outcome: 'success',
            subscriptionId: candidate.subscriptionId,
            correlationId,
            attempts: attempt,
            durationMs: now() - started,
            action: decision.action,
            reason: decision.reason,
          });
          return decision;
        } catch (error) {
          lastError =
            error instanceof RenewalPreflightError
              ? error
              : new RenewalPreflightError('UPSTREAM_UNAVAILABLE', 'Pre-flight failed', true, undefined, error);
          if (!lastError.retryable || attempt === maxAttempts) break;
          await sleep(retryDelayMs * 2 ** (attempt - 1));
        }
      }

      const fallback: RenewalDecision = {
        subscriptionId: candidate.subscriptionId,
        subscriber: candidate.subscriber,
        action: 'review',
        reason: 'PREFLIGHT_UNAVAILABLE',
        riskLevel: 'unknown',
        churnProbability: null,
        modelVersion: 'unavailable',
        idempotencyKey: deriveIdempotencyKey(candidate),
        evaluatedAt: new Date(now()).toISOString(),
        retryAfterSeconds: 60,
        recommendedAction: 'Retry the pre-flight before charging.',
        cacheHit: false,
      };

      telemetry.record({
        operation: 'preflight',
        outcome: 'degraded',
        subscriptionId: candidate.subscriptionId,
        correlationId,
        attempts,
        durationMs: now() - started,
        action: fallback.action,
        reason: lastError?.code ?? 'PREFLIGHT_FAILED',
        errorCode: lastError?.code,
      });
      return fallback;
    },
  };
}
