/**
 * Unit tests for notificationInboxRouter.ts (#1750)
 *
 * Spins up a real http server around the router so request parsing, routing
 * and status codes are exercised end-to-end, then drives it with fetch.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  NotificationCenterService,
} from '../notificationCenterService';
import { createNotificationInboxRouter, parseInboxQuery } from '../notificationInboxRouter';
import type { NotificationRecord } from '../../../../src/types/notification';

const clock = new Date('2026-03-15T12:00:00.000Z');

let center: NotificationCenterService;
let currentHandle: ReturnType<typeof createNotificationInboxRouter>;
let server: http.Server;
let baseUrl: string;

async function deliver(
  userId: string,
  id: string,
  at: Date = clock
): Promise<NotificationRecord> {
  const result = await center.deliver({
    userId,
    type: 'renewal_reminder',
    fallbackSubject: `Subject ${id}`,
    fallbackBody: `Body ${id}`,
    // One record per call — the default fan-out would also hit the second
    // enabled channel and double every count assertion below.
    firstSuccessOnly: true,
    at,
  });
  const record = result.records[0];
  if (!record) throw new Error('deliver produced no record');
  return record;
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    void currentHandle(req, res, (req.url ?? '/').split('?')[0]).then((handled) => {
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unhandled' }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

beforeEach(() => {
  // Fresh service per test keeps history deterministic.
  center = new NotificationCenterService(() => clock);
  // Accepting transports so deliveries land as `delivered`, not `failed`.
  center.registerTransport('push', async () => true);
  center.registerTransport('email', async () => true);
  currentHandle = createNotificationInboxRouter(center);
});

describe('parseInboxQuery', () => {
  it('requires a userId', () => {
    expect(parseInboxQuery(new URLSearchParams())).toEqual({ error: 'userId is required' });
  });

  it('rejects unknown enums and malformed timestamps', () => {
    expect(parseInboxQuery(new URLSearchParams('userId=u&type=nope'))).toEqual({
      error: 'Unknown notification type "nope"',
    });
    expect(parseInboxQuery(new URLSearchParams('userId=u&channel=carrier-pigeon'))).toEqual({
      error: 'Unknown notification channel "carrier-pigeon"',
    });
    expect(parseInboxQuery(new URLSearchParams('userId=u&status=maybe'))).toEqual({
      error: 'Unknown notification status "maybe"',
    });
    expect(parseInboxQuery(new URLSearchParams('userId=u&since=yesterday'))).toEqual({
      error: 'since must be an ISO-8601 timestamp',
    });
    expect(parseInboxQuery(new URLSearchParams('userId=u&limit=0'))).toEqual({
      error: 'limit must be an integer between 1 and 500',
    });
  });

  it('parses a full valid query', () => {
    const query = parseInboxQuery(
      new URLSearchParams(
        'userId=u1&type=charge_failed&channel=sms&status=delivered&unreadOnly=1' +
          '&since=2026-03-01T00:00:00Z&until=2026-04-01T00:00:00Z&limit=50'
      )
    );
    expect(query).toMatchObject({
      userId: 'u1',
      type: 'charge_failed',
      channel: 'sms',
      status: 'delivered',
      unreadOnly: true,
      since: '2026-03-01T00:00:00Z',
      until: '2026-04-01T00:00:00Z',
      limit: 50,
    });
  });
});

describe('GET /api/notifications/history', () => {
  it('400s without a userId', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/history`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'userId is required' });
  });

  it('returns newest first, scoped to the subscriber', async () => {
    const first = await deliver('u1', 'one', new Date('2026-03-15T10:00:00.000Z'));
    const second = await deliver('u1', 'two', new Date('2026-03-15T11:00:00.000Z'));
    await deliver('u2', 'other');

    const res = await fetch(`${baseUrl}/api/notifications/history?userId=u1`);
    const body = (await res.json()) as { records: NotificationRecord[]; total: number };
    expect(res.status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.records.map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it('filters by unreadOnly and applies the limit', async () => {
    const a = await deliver('u1', 'a');
    await deliver('u1', 'b');
    center.markRead(a.id);

    const res = await fetch(
      `${baseUrl}/api/notifications/history?userId=u1&unreadOnly=1&limit=1`
    );
    const body = (await res.json()) as { records: NotificationRecord[]; total: number };
    expect(body.total).toBe(1);
    expect(body.records).toHaveLength(1);
    expect(body.records[0].readAt).toBeUndefined();
  });
});

describe('GET /api/notifications/unread-count', () => {
  it('counts delivered records that have not been read', async () => {
    const record = await deliver('u1', 'x');
    const before = await fetch(`${baseUrl}/api/notifications/unread-count?userId=u1`);
    expect(await before.json()).toEqual({ userId: 'u1', unread: 1 });

    center.markRead(record.id);
    const after = await fetch(`${baseUrl}/api/notifications/unread-count?userId=u1`);
    expect(await after.json()).toEqual({ userId: 'u1', unread: 0 });
  });
});

describe('POST /api/notifications/:id/read and /click', () => {
  it('marks a record read and 404s for an unknown id', async () => {
    const record = await deliver('u1', 'r1');

    const ok = await fetch(`${baseUrl}/api/notifications/${record.id}/read`, { method: 'POST' });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as NotificationRecord).readAt).toBe(clock.toISOString());

    const missing = await fetch(`${baseUrl}/api/notifications/ntf_missing/read`, {
      method: 'POST',
    });
    expect(missing.status).toBe(404);
  });

  it('clicking implies a read', async () => {
    const record = await deliver('u1', 'c1');
    const res = await fetch(`${baseUrl}/api/notifications/${record.id}/click`, {
      method: 'POST',
    });
    const body = (await res.json()) as NotificationRecord;
    expect(body.readAt).toBe(clock.toISOString());
    expect(body.clickedAt).toBe(clock.toISOString());
  });
});

describe('POST /api/notifications/history/read-all', () => {
  it('marks every unread record for the subscriber', async () => {
    await deliver('u1', 'one');
    await deliver('u1', 'two');
    await deliver('u2', 'other');

    const res = await fetch(`${baseUrl}/api/notifications/history/read-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'u1' }),
    });
    expect(await res.json()).toMatchObject({ userId: 'u1', marked: 2 });
    expect(center.getUnreadCount('u1')).toBe(0);
    expect(center.getUnreadCount('u2')).toBe(1);
  });

  it('400s without a userId', async () => {
    const res = await fetch(`${baseUrl}/api/notifications/history/read-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

it('404s on unknown paths under the prefix', async () => {
  const res = await fetch(`${baseUrl}/api/notifications/nope`);
  expect(res.status).toBe(404);
});

it('leaves other prefixes to the caller', async () => {
  const req = new http.IncomingMessage(null as never);
  req.url = '/api/other';
  const res = new http.ServerResponse(req);
  await expect(currentHandle(req, res, '/api/other')).resolves.toBe(false);
});
