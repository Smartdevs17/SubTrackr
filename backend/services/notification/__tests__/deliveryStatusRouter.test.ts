/**
 * deliveryStatusRouter (#1749) — real HTTP server over the router.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  DeliveryReceiptService,
  InMemoryDeliveryReceiptRepository,
} from '../deliveryReceiptService';
import {
  createDeliveryStatusRouter,
  parseStatusCallback,
  isAuthorisedCallback,
} from '../deliveryStatusRouter';

const PREFIX = '/api/delivery-receipts';

function makeService(): DeliveryReceiptService {
  return new DeliveryReceiptService(new InMemoryDeliveryReceiptRepository());
}

async function startServer(
  service: DeliveryReceiptService,
  accountSid?: string
): Promise<{ base: string; close: () => Promise<void> }> {
  const router = createDeliveryStatusRouter(service, { accountSid });
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const handled = await router(req, res, pathname);
    if (!handled) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('parseStatusCallback', () => {
  it('parses a form-encoded Twilio body', () => {
    const parsed = parseStatusCallback(
      'MessageSid=SM123&MessageStatus=delivered&ErrorCode=0',
      'application/x-www-form-urlencoded'
    );
    expect(parsed).toEqual({ MessageSid: 'SM123', MessageStatus: 'delivered', ErrorCode: '0' });
  });

  it('parses a JSON body', () => {
    const parsed = parseStatusCallback('{"MessageSid":"SM1","MessageStatus":"sent"}', 'application/json');
    expect(parsed.MessageSid).toBe('SM1');
  });

  it('treats a JSON content-type on a form body as form data', () => {
    const parsed = parseStatusCallback('MessageSid=SM1&MessageStatus=sent', 'application/json');
    expect(parsed.MessageSid).toBe('SM1');
  });

  it('returns an empty object for a blank body', () => {
    expect(parseStatusCallback('', undefined)).toEqual({});
  });
});

describe('isAuthorisedCallback', () => {
  it('accepts a matching account SID as HTTP Basic username', () => {
    const header = `Basic ${Buffer.from('AC123:').toString('base64')}`;
    expect(isAuthorisedCallback(header, 'AC123')).toBe(true);
  });

  it('rejects a mismatched or missing credential', () => {
    expect(isAuthorisedCallback(undefined, 'AC123')).toBe(false);
    expect(isAuthorisedCallback('Basic ' + Buffer.from('AC999:x').toString('base64'), 'AC123')).toBe(false);
    expect(isAuthorisedCallback('Bearer token', 'AC123')).toBe(false);
  });
});

describe('deliveryStatusRouter over HTTP', () => {
  let service: DeliveryReceiptService;
  let ctx: { base: string; close: () => Promise<void> };

  beforeEach(async () => {
    service = makeService();
    ctx = await startServer(service);
  });

  afterEach(async () => {
    await ctx.close();
  });

  async function seedSms(): Promise<string> {
    const receipt = await service.recordAttempt({
      userId: 'u1',
      type: 'renewal_reminder',
      channel: 'sms',
      providerMessageId: 'SM123',
      accepted: true,
    });
    return receipt.id;
  }

  it('lists receipts for a user', async () => {
    await seedSms();
    const res = await fetch(`${ctx.base}${PREFIX}?userId=u1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(1);
  });

  it('requires a userId on the list route', async () => {
    const res = await fetch(`${ctx.base}${PREFIX}`);
    expect(res.status).toBe(400);
  });

  it('rejects an unknown channel filter', async () => {
    const res = await fetch(`${ctx.base}${PREFIX}?userId=u1&channel=carrier-pigeon`);
    expect(res.status).toBe(400);
  });

  it('returns the summary for a user', async () => {
    await seedSms();
    const res = await fetch(`${ctx.base}${PREFIX}/summary?userId=u1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { byChannel: { sms: { status: string } } };
    expect(body.byChannel.sms.status).toBe('sent');
  });

  it('returns a single receipt by id', async () => {
    const id = await seedSms();
    const res = await fetch(`${ctx.base}${PREFIX}/${id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(id);
  });

  it('404s an unknown receipt id', async () => {
    const res = await fetch(`${ctx.base}${PREFIX}/missing`);
    expect(res.status).toBe(404);
  });

  it('applies a Twilio status callback and advances the receipt', async () => {
    await seedSms();
    const res = await fetch(`${ctx.base}${PREFIX}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ MessageSid: 'SM123', MessageStatus: 'delivered' }).toString(),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('delivered');
    expect((await service.getByProviderMessageId('SM123'))?.status).toBe('delivered');
  });

  it('accepts a JSON status callback', async () => {
    await seedSms();
    const res = await fetch(`${ctx.base}${PREFIX}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ MessageSid: 'SM123', MessageStatus: 'failed', ErrorCode: '30003' }),
    });
    expect(res.status).toBe(200);
    expect((await service.getByProviderMessageId('SM123'))?.errorCode).toBe('30003');
  });

  it('rejects a callback missing required fields', async () => {
    const res = await fetch(`${ctx.base}${PREFIX}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'MessageSid=SM123',
    });
    expect(res.status).toBe(400);
  });

  it('acks an unknown message id without advancing anything', async () => {
    const res = await fetch(`${ctx.base}${PREFIX}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'MessageSid=SM_nope&MessageStatus=delivered',
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { accepted: boolean };
    expect(body.accepted).toBe(false);
  });

  it('acks an unmodelled provider status', async () => {
    const res = await fetch(`${ctx.base}${PREFIX}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'MessageSid=SM123&MessageStatus=read',
    });
    expect(res.status).toBe(202);
  });

  it('returns 404 for an unrelated path', async () => {
    const res = await fetch(`${ctx.base}/nope`);
    expect(res.status).toBe(404);
  });
});

describe('deliveryStatusRouter callback auth', () => {
  it('rejects an unauthorised callback when an account SID is configured', async () => {
    const service = makeService();
    await service.recordAttempt({
      userId: 'u1',
      type: 'renewal_reminder',
      channel: 'sms',
      providerMessageId: 'SM123',
      accepted: true,
    });
    const ctx = await startServer(service, 'AC123');
    try {
      const res = await fetch(`${ctx.base}${PREFIX}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'MessageSid=SM123&MessageStatus=delivered',
      });
      expect(res.status).toBe(401);
    } finally {
      await ctx.close();
    }
  });

  it('accepts an authorised callback', async () => {
    const service = makeService();
    await service.recordAttempt({
      userId: 'u1',
      type: 'renewal_reminder',
      channel: 'sms',
      providerMessageId: 'SM123',
      accepted: true,
    });
    const ctx = await startServer(service, 'AC123');
    try {
      const res = await fetch(`${ctx.base}${PREFIX}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from('AC123:').toString('base64')}`,
        },
        body: 'MessageSid=SM123&MessageStatus=delivered',
      });
      expect(res.status).toBe(200);
    } finally {
      await ctx.close();
    }
  });
});
