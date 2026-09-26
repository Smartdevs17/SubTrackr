import {
  Sampler,
  Tracer,
  InMemorySpanExporter,
  parseTraceparent,
  formatTraceparent,
  extractContext,
  injectContext,
  scrubAttributes,
  toOtlpPayload,
} from '../tracing';

describe('W3C trace context', () => {
  it('round-trips a traceparent', () => {
    const value = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const ctx = parseTraceparent(value);
    expect(ctx).not.toBeNull();
    expect(ctx?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(ctx?.spanId).toBe('00f067aa0ba902b7');
    expect(ctx?.sampled).toBe(true);
    expect(formatTraceparent(ctx!)).toBe(value);
  });

  it('rejects malformed and all-zero ids', () => {
    expect(parseTraceparent('garbage')).toBeNull();
    expect(parseTraceparent('00-' + '0'.repeat(32) + '-00f067aa0ba902b7-01')).toBeNull();
    expect(parseTraceparent(undefined)).toBeNull();
  });

  it('extracts from case-insensitive headers and injects back', () => {
    const ctx = extractContext({
      TraceParent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    });
    expect(ctx?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    const headers = injectContext(ctx!);
    expect(headers.traceparent).toContain('4bf92f3577b34da6a3ce929d0e0e4736');
  });
});

describe('Sampler', () => {
  it('honors a parent decision over the ratio', () => {
    const sampler = new Sampler({ defaultRatio: 0 });
    expect(sampler.shouldSample({ traceId: 'f'.repeat(32), parentSampled: true })).toBe(true);
  });

  it('is deterministic for the same traceId', () => {
    const sampler = new Sampler({ defaultRatio: 0.5 });
    const id = '4bf92f3577b34da6a3ce929d0e0e4736';
    expect(sampler.shouldSample({ traceId: id })).toBe(sampler.shouldSample({ traceId: id }));
  });

  it('applies endpoint overrides', () => {
    const sampler = new Sampler({ defaultRatio: 0, endpointRatios: { 'POST /charges': 1 } });
    expect(sampler.shouldSample({ traceId: 'a'.repeat(32), endpoint: 'POST /charges' })).toBe(true);
    expect(sampler.shouldSample({ traceId: 'a'.repeat(32), endpoint: 'GET /other' })).toBe(false);
  });
});

describe('Tracer', () => {
  it('exports sampled spans with parent linkage and timing', async () => {
    const exporter = new InMemorySpanExporter();
    const tracer = new Tracer({
      serviceName: 'test',
      exporter,
      sampler: new Sampler({ defaultRatio: 1 }),
    });

    await tracer.withSpan('parent', async (parent) => {
      await tracer.withSpan('child', async () => undefined, { parent: parent.context });
    });

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);
    const parent = spans.find((s) => s.name === 'parent')!;
    const child = spans.find((s) => s.name === 'child')!;
    expect(child.traceId).toBe(parent.traceId);
    expect(child.parentSpanId).toBe(parent.spanId);
    expect(parent.status.code).toBe('ok');
    expect(typeof parent.durationMs).toBe('number');
  });

  it('force-keeps errored spans even when sampling would drop them', async () => {
    const exporter = new InMemorySpanExporter();
    const tracer = new Tracer({
      serviceName: 'test',
      exporter,
      sampler: new Sampler({ defaultRatio: 0, alwaysSampleErrors: true }),
    });

    await expect(
      tracer.withSpan('boom', async () => {
        throw new Error('kaboom');
      })
    ).rejects.toThrow('kaboom');

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].status.code).toBe('error');
  });

  it('does not export unsampled, successful spans', async () => {
    const exporter = new InMemorySpanExporter();
    const tracer = new Tracer({
      serviceName: 'test',
      exporter,
      sampler: new Sampler({ defaultRatio: 0, alwaysSampleErrors: false }),
    });
    await tracer.withSpan('quiet', async () => undefined);
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });
});

describe('PII scrubbing + OTLP', () => {
  it('redacts sensitive attribute keys', () => {
    const scrubbed = scrubAttributes({ 'user.email': 'a@b.com', 'http.method': 'GET' });
    expect(scrubbed['user.email']).toBe('[redacted]');
    expect(scrubbed['http.method']).toBe('GET');
  });

  it('produces an OTLP ResourceSpans payload', () => {
    const payload = toOtlpPayload([
      {
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        name: 'op',
        kind: 'server',
        startTime: 1,
        endTime: 2,
        attributes: { 'http.status_code': 200 },
        events: [],
        status: { code: 'ok' },
        service: 'svc',
      },
    ]) as { resourceSpans: unknown[] };
    expect(payload.resourceSpans).toHaveLength(1);
  });
});
