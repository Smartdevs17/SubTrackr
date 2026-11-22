/**
 * Lightweight mobile tracing primitives.
 *
 * The mobile app is a leaf in the distributed trace: it *originates* traces and
 * propagates W3C `traceparent` to the backend so a tap-to-response flow can be
 * stitched together end-to-end. We keep this tiny and dependency-free (no OTel
 * SDK on device) — just enough to generate spec-compliant ids, build the header,
 * and buffer client spans for export.
 *
 * @see https://www.w3.org/TR/trace-context/
 */

export interface MobileSpanContext {
  traceId: string; // 32 hex
  spanId: string; // 16 hex
  sampled: boolean;
}

const hex = (length: number): string => {
  const bytes = new Uint8Array(length / 2);
  const cryptoObj = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    // Non-crypto fallback for environments without getRandomValues (tests).
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

export const generateTraceId = (): string => hex(32);
export const generateSpanId = (): string => hex(16);

export const formatTraceparent = (ctx: MobileSpanContext): string =>
  `00-${ctx.traceId}-${ctx.spanId}-${ctx.sampled ? '01' : '00'}`;

export interface MobileSpan {
  context: MobileSpanContext;
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, string | number | boolean>;
  status: 'unset' | 'ok' | 'error';
}

type SpanSink = (span: MobileSpan) => void;

/**
 * Minimal client tracer. `sampleRatio` controls head sampling; sampled spans are
 * handed to an optional sink (wire to an OTLP exporter or the dev console).
 */
export class MobileTracer {
  private sink: SpanSink | undefined;

  constructor(private readonly sampleRatio: number = 0.1) {}

  setSink(sink: SpanSink): void {
    this.sink = sink;
  }

  startClientSpan(
    name: string,
    attributes: Record<string, string | number | boolean> = {}
  ): MobileSpan {
    const traceId = generateTraceId();
    const bucket = parseInt(traceId.slice(0, 8), 16) / 0xffffffff;
    return {
      context: { traceId, spanId: generateSpanId(), sampled: bucket < this.sampleRatio },
      name,
      startTime: Date.now(),
      attributes,
      status: 'unset',
    };
  }

  endSpan(
    span: MobileSpan,
    status: 'ok' | 'error',
    attributes: Record<string, string | number | boolean> = {}
  ): void {
    span.endTime = Date.now();
    span.status = status;
    Object.assign(span.attributes, attributes);
    if (span.context.sampled || status === 'error') {
      this.sink?.(span);
    }
  }
}

export const mobileTracer = new MobileTracer(
  Number(process.env.EXPO_PUBLIC_OTEL_SAMPLE_RATIO ?? '0.1') || 0.1
);
