/**
 * Distributed tracing core — W3C Trace Context propagation + a minimal,
 * dependency-free tracer that is OpenTelemetry-shaped (spans, kinds, status,
 * attributes, events) and exports OTLP-style payloads.
 *
 * We deliberately avoid pulling the full OpenTelemetry SDK into the shared
 * backend layer: the wire formats (W3C `traceparent`/`tracestate`, OTLP/HTTP)
 * are small and stable, and a self-contained implementation keeps the hot path
 * cheap (the <2% p95 overhead budget) and the dependency surface minimal. The
 * exporter interface is compatible with an OTLP collector, so swapping in the
 * real SDK later is a drop-in.
 *
 * @see https://www.w3.org/TR/trace-context/
 */

import crypto from 'crypto';

// ── Wire types ───────────────────────────────────────────────────────────────

export type SpanKind = 'server' | 'client' | 'producer' | 'consumer' | 'internal';
export type SpanStatusCode = 'unset' | 'ok' | 'error';

export interface SpanContext {
  traceId: string; // 32 hex chars
  spanId: string; // 16 hex chars
  /** Low bit = sampled, per W3C trace-flags. */
  sampled: boolean;
  /** Opaque vendor state, propagated verbatim. */
  traceState?: string;
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, AttributeValue>;
}

export type AttributeValue = string | number | boolean;

export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  attributes: Record<string, AttributeValue>;
  events: SpanEvent[];
  status: { code: SpanStatusCode; message?: string };
  /** Logical service that produced the span — set by the exporter/tracer. */
  service: string;
}

// ── ID + clock seams (overridable for deterministic tests) ────────────────────

export interface TracingClock {
  now(): number;
}

const defaultClock: TracingClock = { now: () => Date.now() };

const randomHex = (bytes: number): string => crypto.randomBytes(bytes).toString('hex');

export const generateTraceId = (): string => randomHex(16); // 128-bit
export const generateSpanId = (): string => randomHex(8); // 64-bit

const INVALID_TRACE_ID = '0'.repeat(32);
const INVALID_SPAN_ID = '0'.repeat(16);

// ── W3C Trace Context (de)serialization ──────────────────────────────────────

const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** Parse a `traceparent` (+ optional `tracestate`) into a SpanContext. */
export const parseTraceparent = (
  traceparent: string | undefined | null,
  tracestate?: string | null
): SpanContext | null => {
  if (!traceparent) return null;
  const match = TRACEPARENT_RE.exec(traceparent.trim());
  if (!match) return null;

  const [, version, traceId, spanId, flags] = match;
  // Only version 00 is defined; future versions must still be parseable but we
  // reject the all-zero (invalid) ids per spec.
  if (version === 'ff') return null;
  if (traceId === INVALID_TRACE_ID || spanId === INVALID_SPAN_ID) return null;

  return {
    traceId,
    spanId,
    sampled: (parseInt(flags, 16) & 0x01) === 0x01,
    traceState: tracestate ?? undefined,
  };
};

/** Serialize a SpanContext into a W3C `traceparent` header value. */
export const formatTraceparent = (ctx: SpanContext): string =>
  `00-${ctx.traceId}-${ctx.spanId}-${ctx.sampled ? '01' : '00'}`;

const HEADER_TRACEPARENT = 'traceparent';
const HEADER_TRACESTATE = 'tracestate';

type HeaderBag = Record<string, string | string[] | undefined>;

const headerValue = (headers: HeaderBag, name: string): string | undefined => {
  // HTTP headers are case-insensitive.
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  const raw = key ? headers[key] : undefined;
  return Array.isArray(raw) ? raw[0] : raw;
};

/** Extract a parent SpanContext from an incoming request's headers. */
export const extractContext = (headers: HeaderBag): SpanContext | null =>
  parseTraceparent(headerValue(headers, HEADER_TRACEPARENT), headerValue(headers, HEADER_TRACESTATE));

/** Inject a SpanContext into outgoing headers for downstream propagation. */
export const injectContext = (
  ctx: SpanContext,
  headers: Record<string, string> = {}
): Record<string, string> => {
  headers[HEADER_TRACEPARENT] = formatTraceparent(ctx);
  if (ctx.traceState) headers[HEADER_TRACESTATE] = ctx.traceState;
  return headers;
};

// ── Sampling ─────────────────────────────────────────────────────────────────

export interface SamplerConfig {
  /** Base probability [0,1] applied when no endpoint rule matches. */
  defaultRatio: number;
  /** Per-endpoint overrides, keyed by route name (e.g. "POST /v1/charges"). */
  endpointRatios?: Record<string, number>;
  /** Always sample traces that end in error, regardless of ratio. */
  alwaysSampleErrors?: boolean;
}

export interface SampleInput {
  traceId: string;
  endpoint?: string;
  /** A parent decision (from an upstream service) takes precedence when present. */
  parentSampled?: boolean;
}

/**
 * Deterministic, consistent sampler. The decision is derived from the traceId so
 * every service in a trace makes the *same* choice (no partial traces), and a
 * parent's decision is always honored to keep traces whole across hops.
 */
export class Sampler {
  constructor(private readonly config: SamplerConfig) {}

  shouldSample(input: SampleInput): boolean {
    if (input.parentSampled !== undefined) return input.parentSampled;

    const endpointRatio = input.endpoint
      ? this.config.endpointRatios?.[input.endpoint]
      : undefined;
    const ratio = endpointRatio ?? this.config.defaultRatio;
    if (ratio >= 1) return true;
    if (ratio <= 0) return false;

    // Map the high 32 bits of the traceId to [0,1) — consistent across services.
    const bucket = parseInt(input.traceId.slice(0, 8), 16) / 0xffffffff;
    return bucket < ratio;
  }

  /** Error-based sampling: force-keep a trace that errored (if configured). */
  forceOnError(): boolean {
    return this.config.alwaysSampleErrors ?? true;
  }
}

// ── PII scrubbing ─────────────────────────────────────────────────────────────

const DEFAULT_REDACT_KEYS = [
  'authorization',
  'cookie',
  'password',
  'token',
  'secret',
  'apikey',
  'api_key',
  'email',
  'phone',
  'ssn',
  'card',
  'wallet',
];

/** Strip likely-PII attribute values before a span leaves the process. */
export const scrubAttributes = (
  attributes: Record<string, AttributeValue>,
  redactKeys: string[] = DEFAULT_REDACT_KEYS
): Record<string, AttributeValue> => {
  const result: Record<string, AttributeValue> = {};
  for (const [key, value] of Object.entries(attributes)) {
    const lower = key.toLowerCase();
    result[key] = redactKeys.some((r) => lower.includes(r)) ? '[redacted]' : value;
  }
  return result;
};

// ── Exporters ─────────────────────────────────────────────────────────────────

export interface SpanExporter {
  export(spans: SpanData[]): void | Promise<void>;
}

/** Buffers spans in memory — used by tests and the dashboard endpoint. */
export class InMemorySpanExporter implements SpanExporter {
  private spans: SpanData[] = [];
  export(spans: SpanData[]): void {
    this.spans.push(...spans);
  }
  getFinishedSpans(): SpanData[] {
    return [...this.spans];
  }
  reset(): void {
    this.spans = [];
  }
}

/**
 * Posts spans to an OpenTelemetry collector over OTLP/HTTP-JSON. Fire-and-forget
 * and best-effort: tracing must never break or slow the request path, so export
 * failures are swallowed (and surfaced via the optional onError hook).
 */
export class OtlpHttpSpanExporter implements SpanExporter {
  constructor(
    private readonly options: {
      endpoint: string; // e.g. http://otel-collector:4318/v1/traces
      fetchImpl?: typeof fetch;
      onError?: (err: unknown) => void;
    }
  ) {}

  async export(spans: SpanData[]): Promise<void> {
    if (spans.length === 0) return;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    try {
      await fetchImpl(this.options.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toOtlpPayload(spans)),
      });
    } catch (err) {
      this.options.onError?.(err);
    }
  }
}

/** Convert internal spans to a minimal OTLP/JSON ResourceSpans payload. */
export const toOtlpPayload = (spans: SpanData[]): unknown => ({
  resourceSpans: [
    {
      resource: {
        attributes: [{ key: 'service.name', value: { stringValue: spans[0]?.service ?? 'unknown' } }],
      },
      scopeSpans: [
        {
          scope: { name: 'subtrackr-tracing' },
          spans: spans.map((s) => ({
            traceId: s.traceId,
            spanId: s.spanId,
            parentSpanId: s.parentSpanId,
            name: s.name,
            kind: s.kind,
            startTimeUnixNano: s.startTime * 1e6,
            endTimeUnixNano: (s.endTime ?? s.startTime) * 1e6,
            attributes: Object.entries(s.attributes).map(([key, value]) => ({
              key,
              value: attributeToOtlp(value),
            })),
            status: { code: s.status.code, message: s.status.message },
          })),
        },
      ],
    },
  ],
});

const attributeToOtlp = (value: AttributeValue) => {
  if (typeof value === 'number') return { doubleValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  return { stringValue: value };
};

// ── Span + Tracer ──────────────────────────────────────────────────────────────

export class Span {
  readonly context: SpanContext;
  readonly data: SpanData;
  private ended = false;

  constructor(
    data: SpanData,
    sampled: boolean,
    private readonly clock: TracingClock,
    private readonly onEnd: (span: Span) => void
  ) {
    this.data = data;
    this.context = { traceId: data.traceId, spanId: data.spanId, sampled };
  }

  setAttribute(key: string, value: AttributeValue): this {
    this.data.attributes[key] = value;
    return this;
  }

  setAttributes(attributes: Record<string, AttributeValue>): this {
    Object.assign(this.data.attributes, attributes);
    return this;
  }

  addEvent(name: string, attributes?: Record<string, AttributeValue>): this {
    this.data.events.push({ name, timestamp: this.clock.now(), attributes });
    return this;
  }

  setStatus(code: SpanStatusCode, message?: string): this {
    this.data.status = { code, message };
    return this;
  }

  recordException(error: unknown): this {
    const message = error instanceof Error ? error.message : String(error);
    this.addEvent('exception', { 'exception.message': message });
    return this.setStatus('error', message);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.data.endTime = this.clock.now();
    this.data.durationMs = this.data.endTime - this.data.startTime;
    this.onEnd(this);
  }
}

export interface TracerOptions {
  serviceName: string;
  exporter: SpanExporter;
  sampler: Sampler;
  clock?: TracingClock;
  redactKeys?: string[];
}

export interface StartSpanOptions {
  kind?: SpanKind;
  parent?: SpanContext | null;
  attributes?: Record<string, AttributeValue>;
  /** Route name used for endpoint-based sampling. */
  endpoint?: string;
}

export class Tracer {
  private readonly clock: TracingClock;

  constructor(private readonly options: TracerOptions) {
    this.clock = options.clock ?? defaultClock;
  }

  startSpan(name: string, opts: StartSpanOptions = {}): Span {
    const parent = opts.parent ?? null;
    const traceId = parent?.traceId ?? generateTraceId();
    const sampled = this.options.sampler.shouldSample({
      traceId,
      endpoint: opts.endpoint,
      parentSampled: parent?.sampled,
    });

    const data: SpanData = {
      traceId,
      spanId: generateSpanId(),
      parentSpanId: parent?.spanId,
      name,
      kind: opts.kind ?? 'internal',
      startTime: this.clock.now(),
      attributes: opts.attributes ? { ...opts.attributes } : {},
      events: [],
      status: { code: 'unset' },
      service: this.options.serviceName,
    };

    return new Span(data, sampled, this.clock, (span) => this.onSpanEnd(span));
  }

  /** Wrap an async unit of work in a span, recording timing, errors and status. */
  async withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    opts: StartSpanOptions = {}
  ): Promise<T> {
    const span = this.startSpan(name, opts);
    try {
      const result = await fn(span);
      if (span.data.status.code === 'unset') span.setStatus('ok');
      return result;
    } catch (err) {
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  }

  private onSpanEnd(span: Span): void {
    const errored = span.data.status.code === 'error';
    // Error-based sampling: keep an errored trace even if probabilistic
    // sampling would have dropped it.
    const keep = span.context.sampled || (errored && this.options.sampler.forceOnError());
    if (!keep) return;

    span.data.attributes = scrubAttributes(span.data.attributes, this.options.redactKeys);
    void this.options.exporter.export([span.data]);
  }
}

// ── Default process tracer ─────────────────────────────────────────────────────

const num = (value: string | undefined, fallback: number): number => {
  const parsed = value === undefined ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Build a tracer from environment configuration. The exporter is OTLP/HTTP when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set, otherwise an in-memory buffer (tests/dev).
 */
export const createTracerFromEnv = (
  serviceName: string,
  env: NodeJS.ProcessEnv = process.env
): Tracer => {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const exporter: SpanExporter = endpoint
    ? new OtlpHttpSpanExporter({ endpoint: `${endpoint.replace(/\/$/, '')}/v1/traces` })
    : new InMemorySpanExporter();

  const sampler = new Sampler({
    defaultRatio: num(env.OTEL_TRACES_SAMPLER_RATIO, 0.1),
    alwaysSampleErrors: env.OTEL_TRACES_SAMPLE_ERRORS !== 'false',
  });

  return new Tracer({ serviceName, exporter, sampler });
};
