/**
 * notificationTemplateRouter (#1748) — real HTTP server over the router.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  NotificationTemplateVersionService,
  InMemoryTemplateVersionRepository,
} from '../notificationTemplateVersionService';
import { createNotificationTemplateRouter } from '../notificationTemplateRouter';

const PREFIX = '/api/notification-templates';

function makeService(): NotificationTemplateVersionService {
  return new NotificationTemplateVersionService(new InMemoryTemplateVersionRepository());
}

async function startServer(
  service: NotificationTemplateVersionService
): Promise<{ base: string; close: () => Promise<void> }> {
  const router = createNotificationTemplateRouter(service);
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

function postJson(base: string, path: string, body: unknown) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('notificationTemplateRouter over HTTP', () => {
  let service: NotificationTemplateVersionService;
  let ctx: { base: string; close: () => Promise<void> };

  beforeEach(async () => {
    service = makeService();
    ctx = await startServer(service);
  });

  afterEach(async () => {
    await ctx.close();
  });

  const seed = () =>
    postJson(ctx.base, `${PREFIX}/renewal_reminder/email`, {
      subject: 'v1',
      body: 'Body {{name}}',
      variables: ['name'],
    });

  it('creates the first version with 201', async () => {
    const res = await seed();
    expect(res.status).toBe(201);
    const body = (await res.json()) as { template: { version: number }; created: boolean };
    expect(body.created).toBe(true);
    expect(body.template.version).toBe(1);
  });

  it('returns 200 for a no-op save', async () => {
    await seed();
    const res = await postJson(ctx.base, `${PREFIX}/renewal_reminder/email`, {
      subject: 'v1',
      body: 'Body {{name}}',
      variables: ['name'],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: boolean };
    expect(body.created).toBe(false);
  });

  it('lists template keys', async () => {
    await seed();
    const res = await fetch(`${ctx.base}${PREFIX}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { templates: string[] };
    expect(body.templates).toContain('renewal_reminder:email');
  });

  it('returns the current version', async () => {
    await seed();
    const res = await fetch(`${ctx.base}${PREFIX}/renewal_reminder/email`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: number; subject: string };
    expect(body.subject).toBe('v1');
  });

  it('404s a template with no versions', async () => {
    const res = await fetch(`${ctx.base}${PREFIX}/digest/push`);
    expect(res.status).toBe(404);
  });

  it('returns the full version history', async () => {
    await seed();
    await postJson(ctx.base, `${PREFIX}/renewal_reminder/email`, { subject: 'v2', body: 'x', variables: [] });
    const res = await fetch(`${ctx.base}${PREFIX}/renewal_reminder/email/versions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { versions: { version: number }[] };
    expect(body.versions.map((v) => v.version)).toEqual([1, 2]);
  });

  it('rolls back via a query parameter', async () => {
    await seed();
    await postJson(ctx.base, `${PREFIX}/renewal_reminder/email`, { subject: 'bad', body: 'y', variables: [] });

    const res = await fetch(`${ctx.base}${PREFIX}/renewal_reminder/email/rollback?version=1`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: number; subject: string };
    expect(body.subject).toBe('v1');
    expect(body.version).toBe(3);
  });

  it('rolls back via a JSON body', async () => {
    await seed();
    await postJson(ctx.base, `${PREFIX}/renewal_reminder/email`, { subject: 'bad', body: 'y', variables: [] });

    const res = await postJson(`${ctx.base}`, `${PREFIX}/renewal_reminder/email/rollback`, { version: 1 });
    expect(res.status).toBe(200);
  });

  it('rejects a rollback without a version', async () => {
    await seed();
    const res = await fetch(`${ctx.base}${PREFIX}/renewal_reminder/email/rollback`, { method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown type or channel', async () => {
    const res = await fetch(`${ctx.base}${PREFIX}/not_a_type/email`);
    expect(res.status).toBe(400);
  });

  it('404s an unrelated path', async () => {
    const res = await fetch(`${ctx.base}/nope`);
    expect(res.status).toBe(404);
  });
});
