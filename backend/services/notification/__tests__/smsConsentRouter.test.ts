/**
 * smsConsentRouter (#1747)
 *
 * Covers routing, JSON responses, body parsing, source validation, and the
 * 404/400 error paths. The router is driven with lightweight request/response
 * doubles rather than a live server.
 */

import { describe, expect, it, beforeEach } from '@jest/globals';
import type http from 'node:http';

import { createSmsConsentRouter } from '../smsConsentRouter';
import {
  InMemorySmsConsentRepository,
  SmsConsentService,
} from '../smsConsentService';

interface Captured {
  status: number;
  body: unknown;
}

/**
 * Simpler driver that resolves the body synchronously: the router's
 * `readJsonBody` attaches `data`/`end` listeners, which we trigger here.
 */
async function invoke(
  router: ReturnType<typeof createSmsConsentRouter>,
  method: string,
  pathname: string,
  body?: Record<string, unknown>
): Promise<Captured> {
  const handlers: Record<string, Array<(arg?: unknown) => void>> = {};
  const req = {
    method,
    on(event: string, cb: (arg?: unknown) => void) {
      (handlers[event] ??= []).push(cb);
      return this;
    },
  } as unknown as http.IncomingMessage;

  const captured: Captured = { status: 0, body: undefined };
  const res = {
    writeHead(status: number) {
      captured.status = status;
      return this;
    },
    end(payload?: string) {
      captured.body = payload ? JSON.parse(payload) : undefined;
      return this;
    },
  } as unknown as http.ServerResponse;

  const handled = router(req, res, pathname);

  // Feed the request body (or EOF) so `readJsonBody` settles.
  if (body !== undefined) {
    const raw = Buffer.from(JSON.stringify(body));
    for (const cb of handlers['data'] ?? []) cb(raw);
  }
  for (const cb of handlers['end'] ?? []) cb();

  await handled;
  return captured;
}

function makeService() {
  return new SmsConsentService({ repository: new InMemorySmsConsentRepository() });
}

describe('createSmsConsentRouter', () => {
  let service: SmsConsentService;
  let router: ReturnType<typeof createSmsConsentRouter>;

  beforeEach(() => {
    service = makeService();
    router = createSmsConsentRouter(service);
  });

  it('ignores paths outside its prefix', async () => {
    const req = { method: 'GET', on: () => req } as unknown as http.IncomingMessage;
    const res = {} as http.ServerResponse;
    expect(await router(req, res, '/api/other')).toBe(false);
  });

  it('returns the current consent record', async () => {
    await service.optIn('+15550001111', 'web_form', { userId: 'user-1' });
    const { status, body } = await invoke(router, 'GET', '/api/sms-consent/+15550001111');
    expect(status).toBe(200);
    expect(body).toMatchObject({ phone: '+15550001111', status: 'opted_in', source: 'web_form' });
  });

  it('returns 404 for an unknown number', async () => {
    const { status, body } = await invoke(router, 'GET', '/api/sms-consent/+19999999999');
    expect(status).toBe(404);
    expect(body).toMatchObject({ error: expect.stringContaining('+19999999999') });
  });

  it('returns the audit trail', async () => {
    await service.optOut('+15550001111', 'admin', { reason: 'spam' });
    const { status, body } = await invoke(router, 'GET', '/api/sms-consent/+15550001111/events');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      events: [expect.objectContaining({ status: 'opted_out', source: 'admin', reason: 'spam' })],
    });
  });

  it('lists records owned by a user', async () => {
    await service.optIn('+15550001111', 'web_form', { userId: 'user-1' });
    await service.optIn('+15550002222', 'web_form', { userId: 'user-2' });
    const { status, body } = await invoke(router, 'GET', '/api/sms-consent/user/user-1');
    expect(status).toBe(200);
    expect(body).toMatchObject({ consents: [expect.objectContaining({ phone: '+15550001111' })] });
  });

  it('records an opt-out from a POST body', async () => {
    const { status, body } = await invoke(router, 'POST', '/api/sms-consent/+15550001111/opt-out', {
      source: 'admin',
      reason: 'requested',
      userId: 'user-1',
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'opted_out', source: 'admin', reason: 'requested' });
    expect(await service.isOptedOut('+15550001111')).toBe(true);
  });

  it('defaults the opt-in source to web_form', async () => {
    const { body } = await invoke(router, 'POST', '/api/sms-consent/+15550001111/opt-in', {});
    expect(body).toMatchObject({ status: 'opted_in', source: 'web_form' });
  });

  it('rejects an unknown consent source', async () => {
    const { status, body } = await invoke(router, 'POST', '/api/sms-consent/+15550001111/opt-out', {
      source: 'carrier_pigeon',
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: expect.stringContaining('carrier_pigeon') });
  });

  it('rejects malformed JSON', async () => {
    const handlers: Record<string, Array<(arg?: unknown) => void>> = {};
    const req = {
      method: 'POST',
      on(event: string, cb: (arg?: unknown) => void) {
        (handlers[event] ??= []).push(cb);
        return this;
      },
    } as unknown as http.IncomingMessage;
    let status = 0;
    let body: unknown;
    const res = {
      writeHead(s: number) {
        status = s;
        return this;
      },
      end(payload?: string) {
        body = payload ? JSON.parse(payload) : undefined;
        return this;
      },
    } as unknown as http.ServerResponse;

    const handled = router(req, res, '/api/sms-consent/+15550001111/opt-in');
    for (const cb of handlers['data'] ?? []) cb(Buffer.from('{not json'));
    for (const cb of handlers['end'] ?? []) cb();
    await handled;

    expect(status).toBe(400);
    expect(body).toMatchObject({ error: expect.stringContaining('Invalid JSON') });
  });

  it('rejects a request with no phone segment', async () => {
    const req = { method: 'GET', on: () => req } as unknown as http.IncomingMessage;
    let status = 0;
    let body: unknown;
    const res = {
      writeHead(s: number) {
        status = s;
        return this;
      },
      end(payload?: string) {
        body = payload ? JSON.parse(payload) : undefined;
        return this;
      },
    } as unknown as http.ServerResponse;
    await router(req, res, '/api/sms-consent');
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: expect.any(String) });
  });
});
