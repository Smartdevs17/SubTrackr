/**
 * Backend instrumentation helpers built on the tracing core.
 *
 * These wrap the three span shapes the acceptance criteria call for —
 * database queries, external calls, and business logic — plus the server-side
 * span that adopts the incoming W3C context. They keep instrumentation a
 * one-liner at call sites so coverage is easy to add and the overhead budget
 * (<2% p95) is respected (spans are cheap objects; export is async/best-effort).
 */

import {
  AttributeValue,
  Span,
  SpanContext,
  Tracer,
  createTracerFromEnv,
  extractContext,
  injectContext,
} from './tracing';

let sharedTracer: Tracer | null = null;

/** Process-wide tracer, created lazily from env. Override in tests via setTracer. */
export const getTracer = (): Tracer => {
  if (!sharedTracer) {
    sharedTracer = createTracerFromEnv(process.env.OTEL_SERVICE_NAME ?? 'subtrackr-backend');
  }
  return sharedTracer;
};

export const setTracer = (tracer: Tracer): void => {
  sharedTracer = tracer;
};

type HeaderBag = Record<string, string | string[] | undefined>;

/**
 * Open a SERVER span for an inbound request, adopting any upstream trace context
 * so the request joins an existing distributed trace rather than starting a new
 * one. Returns the span and a `headers()` helper to propagate to downstream hops.
 */
export const startServerSpan = (
  name: string,
  headers: HeaderBag,
  attributes: Record<string, AttributeValue> = {}
): { span: Span; downstreamHeaders: () => Record<string, string> } => {
  const parent = extractContext(headers);
  const span = getTracer().startSpan(name, {
    kind: 'server',
    parent,
    endpoint: name,
    attributes,
  });
  return {
    span,
    downstreamHeaders: () => injectContext(span.context),
  };
};

/** Trace a database query. Records the statement label (never raw PII values). */
export const traceDbQuery = <T>(
  operation: string,
  parent: SpanContext | null,
  fn: (span: Span) => Promise<T>,
  attributes: Record<string, AttributeValue> = {}
): Promise<T> =>
  getTracer().withSpan(`db ${operation}`, fn, {
    kind: 'client',
    parent,
    attributes: { 'db.system': 'postgresql', 'db.operation': operation, ...attributes },
  });

/** Trace an outbound HTTP/RPC call and inject context into the call's headers. */
export const traceExternalCall = <T>(
  target: string,
  parent: SpanContext | null,
  fn: (span: Span, downstreamHeaders: Record<string, string>) => Promise<T>,
  attributes: Record<string, AttributeValue> = {}
): Promise<T> =>
  getTracer().withSpan(
    `external ${target}`,
    (span) => fn(span, injectContext(span.context)),
    { kind: 'client', parent, attributes: { 'peer.service': target, ...attributes } }
  );

/** Trace an internal business-logic step. */
export const traceBusinessLogic = <T>(
  name: string,
  parent: SpanContext | null,
  fn: (span: Span) => Promise<T>,
  attributes: Record<string, AttributeValue> = {}
): Promise<T> =>
  getTracer().withSpan(name, fn, { kind: 'internal', parent, attributes });

export { extractContext, injectContext } from './tracing';
export type { Span, SpanContext } from './tracing';
