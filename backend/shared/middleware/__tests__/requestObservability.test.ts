import http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  createRequestObservability,
  resolveRequestId,
  sanitizePath,
} from '../requestObservability';
import { clearLogBuffer, createLoggerFor, logger as rootLogger, queryLogs } from '../../../services/shared/logging';
import { InMemorySpanExporter, Sampler, Tracer } from '../../../services/shared/tracing';

const exporter = new InMemorySpanExporter();
const tracer = new Tracer({
  serviceName: 'test-api',
  exporter,
  sampler: new Sampler({ defaultRatio: 1, alwaysSampleErrors: true }),
});
const observe = createRequestObservability({ tracer, logger: createLoggerFor('http') });

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) =>
    observe(req, res, () => {
      // A log written by the handler must carry the request's correlation id.
      rootLogger.info('handler ran');
      const status = req.url?.startsWith('/boom') ? 500 : 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: status === 200 }));
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  exporter.reset();
  clearLogBuffer();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const requestLogs = () => queryLogs({ text: 'http.request' }).filter((e) => e.message === 'http.request');

describe('resolveRequestId', () => {
  it('keeps a well-formed caller id', () => {
    expect(resolveRequestId('req-123_abc')).toBe('req-123_abc');
  });

  it('replaces missing, oversized or unsafe ids with a uuid', () => {
    const uuid = /^[0-9a-f-]{36}$/;
    expect(resolveRequestId(undefined)).toMatch(uuid);
    expect(resolveRequestId('a'.repeat(200))).toMatch(uuid);
    expect(resolveRequestId('bad id\nwith newline')).toMatch(uuid);
  });
});

describe('sanitizePath', () => {
  it('drops the query string and masks email and long number segments', () => {
    expect(sanitizePath('/users/jane%40example.com/cards/4111111111111111?token=abc')).toBe(
      '/users/:redacted/cards/:redacted',
    );
  });

  it('leaves ordinary ids alone', () => {
    expect(sanitizePath('/plans/basic/42')).toBe('/plans/basic/42');
  });
});

describe('request observability middleware', () => {
  it('generates a request id, echoes it and uses it as the log correlation id', async () => {
    const res = await fetch(`${baseUrl}/plans`);
    const requestId = res.headers.get('x-request-id');

    expect(requestId).toBeTruthy();
    const handlerLog = queryLogs({ text: 'handler ran' })[0];
    expect(handlerLog?.correlationId).toBe(requestId);

    const [log] = requestLogs();
    expect(log.correlationId).toBe(requestId);
    expect(log.meta).toMatchObject({ requestId, method: 'GET', path: '/plans', status: 200 });
  });

  it('propagates a caller-supplied request id', async () => {
    const res = await fetch(`${baseUrl}/plans`, { headers: { 'X-Request-Id': 'client-abc-1' } });

    expect(res.headers.get('x-request-id')).toBe('client-abc-1');
    expect(requestLogs()[0].correlationId).toBe('client-abc-1');
  });

  it('exports a server span that continues the caller trace and matches the log', async () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const parentSpanId = '00f067aa0ba902b7';
    await fetch(`${baseUrl}/plans`, {
      headers: { traceparent: `00-${traceId}-${parentSpanId}-01`, 'X-Request-Id': 'trace-1' },
    });

    const [span] = exporter.getFinishedSpans();
    expect(span).toMatchObject({
      traceId,
      parentSpanId,
      kind: 'server',
      name: 'GET /plans',
      status: { code: 'ok' },
    });
    expect(span.attributes).toMatchObject({ 'request.id': 'trace-1', 'http.status_code': 200 });

    const [log] = requestLogs();
    expect(log.meta).toMatchObject({ traceId, spanId: span.spanId });
  });

  it('marks 5xx responses as errors on the span and the log', async () => {
    await fetch(`${baseUrl}/boom`);

    expect(exporter.getFinishedSpans()[0].status.code).toBe('error');
    expect(requestLogs()[0].level).toBe('error');
  });

  it('never logs query strings, headers or client addresses', async () => {
    await fetch(`${baseUrl}/users/jane%40example.com?email=jane%40example.com&token=secret`, {
      headers: { Authorization: 'Bearer secret-token', Cookie: 'sid=secret-cookie' },
    });

    const serialized = JSON.stringify(requestLogs()) + JSON.stringify(exporter.getFinishedSpans());
    expect(serialized).not.toMatch(/jane|secret|token=|127\.0\.0\.1|authorization|cookie/i);
    expect(requestLogs()[0].meta).toMatchObject({ path: '/users/:redacted' });
  });
});
