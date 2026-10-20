/**
 * Unit tests for overdueInvoiceReminderRouter.ts (#1737)
 *
 * Covers:
 *  - POST /overdue-reminders               → create a schedule (201 / 400)
 *  - GET  /overdue-reminders?merchantId    → list schedules (200 / 400)
 *  - GET  /overdue-reminders/entries       → list entries, status filter
 *  - POST /overdue-reminders/run-now       → trigger a pass (200 / 503)
 *  - POST /overdue-reminders/invoices/:id/stop → stop on payment
 *  - GET/PATCH/DELETE /overdue-reminders/:id
 *  - 405 for unsupported methods, false for non-matching paths
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import type http from 'node:http';
import {
  OverdueInvoiceReminderService,
  createOverdueInvoiceReminderService,
  type OverdueInvoice,
} from '../overdueInvoiceReminderService';
import { createOverdueInvoiceReminderRouter } from '../overdueInvoiceReminderRouter';
import type { EmailMessage, EmailProvider } from '../emailProvider';

// The real template module pulls in the ESM-only workspace package
// `@subtrackr/notification-providers`, which the backend's CJS jest config
// cannot parse.
jest.mock('../transactionalEmailTemplates', () => ({
  renderTransactionalEmail: (
    templateId: string,
    vars: Record<string, string>
  ) => {
    const subject = `${vars['escalation_label']}: invoice ${vars['invoice_number']} is ${vars['overdue_phrase']} overdue`;
    const text = `Amount outstanding: ${vars['currency']} ${vars['amount']}.`;
    return { subject, plainSubject: subject, text, html: `<p>${text}</p>` };
  },
}));

// ─── Mock helpers (same pattern as mrrDashboardRouter.test.ts) ────────────────

type MockRes = http.ServerResponse & {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  json(): unknown;
};

function makeRes(): MockRes {
  const headers: Record<string, string> = {};
  let statusCode = 0;
  let body = '';
  return {
    writeHead(code: number, hdrs?: Record<string, string>) {
      statusCode = code;
      Object.assign(headers, hdrs ?? {});
    },
    end(data?: unknown) {
      body = data ? String(data) : '';
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    get headers() {
      return headers;
    },
    json() {
      return JSON.parse(body);
    },
  } as unknown as MockRes;
}

function makeReq(method: string, url: string, bodyObj?: unknown): http.IncomingMessage {
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
  const chunks = bodyStr ? [Buffer.from(bodyStr)] : [];
  const req = {
    method,
    url,
    headers: { host: 'localhost' },
    on(event: string, handler: (chunk?: unknown) => void) {
      if (event === 'data') for (const c of chunks) handler(c);
      if (event === 'end') handler();
      return req;
    },
  } as unknown as http.IncomingMessage;
  return req;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MERCHANT = 'merch_1';

const emailProvider: EmailProvider = {
  providerName: 'stub',
  send: async (): Promise<EmailResultStub> => ({ success: true, provider: 'stub' }),
};
type EmailResultStub = { success: boolean; provider: 'stub' };

function makeService(): OverdueInvoiceReminderService {
  return createOverdueInvoiceReminderService({
    emailProvider,
    fromAddress: 'billing@subtrackr.com',
  });
}

function makeInvoice(overrides: Partial<OverdueInvoice> = {}): OverdueInvoice {
  return {
    id: 'inv_1001',
    invoiceNumber: 'INV-1001',
    merchantId: MERCHANT,
    customerName: 'Dana Lee',
    customerEmail: 'dana@example.com',
    subscriptionName: 'Pro Plan',
    amount: 49.5,
    currency: 'USD',
    // Slightly overdue so discovery creates an active entry without sending
    // (the first stage is due a full day after the due date, and the router
    // service uses the real clock).
    dueDate: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    status: 'sent',
    ...overrides,
  };
}

let service: OverdueInvoiceReminderService;
let handle: ReturnType<typeof createOverdueInvoiceReminderRouter>;

beforeEach(() => {
  service = makeService();
  handle = createOverdueInvoiceReminderRouter(service, () => [makeInvoice()]);
});

// ─── Routing ──────────────────────────────────────────────────────────────────

describe('overdueInvoiceReminderRouter — routing', () => {
  it('returns false for paths outside /overdue-reminders', async () => {
    const res = makeRes();
    expect(await handle(makeReq('GET', '/other'), res, '/other')).toBe(false);
  });

  it('returns false for a deeper path that only shares the prefix', async () => {
    const res = makeRes();
    expect(
      await handle(makeReq('GET', '/overdue-reminders-elsewhere'), res, '/overdue-reminders-elsewhere')
    ).toBe(false);
  });
});

// ─── Schedule CRUD ────────────────────────────────────────────────────────────

describe('overdueInvoiceReminderRouter — schedule CRUD', () => {
  it('creates a schedule with defaults (201)', async () => {
    const res = makeRes();
    await handle(
      makeReq('POST', '/overdue-reminders', { merchantId: MERCHANT }),
      res,
      '/overdue-reminders'
    );
    expect(res.statusCode).toBe(201);
    const schedule = res.json() as { merchantId: string; enabled: boolean; stages: unknown[] };
    expect(schedule.merchantId).toBe(MERCHANT);
    expect(schedule.enabled).toBe(true);
    expect(schedule.stages).toHaveLength(4);
  });

  it('creates a schedule with custom stages and recipients (201)', async () => {
    const res = makeRes();
    await handle(
      makeReq('POST', '/overdue-reminders', {
        merchantId: MERCHANT,
        stages: [
          { daysOverdue: 2, label: 'Heads up' },
          { daysOverdue: 9, label: 'Final notice' },
        ],
        recipients: ['ar@example.com'],
        enabled: false,
      }),
      res,
      '/overdue-reminders'
    );
    expect(res.statusCode).toBe(201);
    const schedule = res.json() as {
      enabled: boolean;
      stages: Array<{ daysOverdue: number }>;
      recipients: string[];
    };
    expect(schedule.enabled).toBe(false);
    expect(schedule.stages.map((s) => s.daysOverdue)).toEqual([2, 9]);
    expect(schedule.recipients).toEqual(['ar@example.com']);
  });

  it('returns 400 on create with a missing merchantId', async () => {
    const res = makeRes();
    await handle(makeReq('POST', '/overdue-reminders', {}), res, '/overdue-reminders');
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/merchantId/);
  });

  it('returns 400 on create with invalid stages', async () => {
    const res = makeRes();
    await handle(
      makeReq('POST', '/overdue-reminders', {
        merchantId: MERCHANT,
        stages: [{ daysOverdue: 5, label: 'a' }, { daysOverdue: 1, label: 'b' }],
      }),
      res,
      '/overdue-reminders'
    );
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/strictly increasing/);
  });

  it('lists schedules for a merchant (200) and requires merchantId (400)', async () => {
    const created = makeRes();
    await handle(
      makeReq('POST', '/overdue-reminders', { merchantId: MERCHANT }),
      created,
      '/overdue-reminders'
    );

    const listed = makeRes();
    await handle(
      makeReq('GET', `/overdue-reminders?merchantId=${MERCHANT}`),
      listed,
      '/overdue-reminders'
    );
    expect(listed.statusCode).toBe(200);
    expect(listed.json() as unknown[]).toHaveLength(1);

    const missing = makeRes();
    await handle(makeReq('GET', '/overdue-reminders'), missing, '/overdue-reminders');
    expect(missing.statusCode).toBe(400);
  });

  it('gets a single schedule (200) or 404 for an unknown id', async () => {
    const created = makeRes();
    await handle(
      makeReq('POST', '/overdue-reminders', { merchantId: MERCHANT }),
      created,
      '/overdue-reminders'
    );
    const { id } = created.json() as { id: string };

    const res = makeRes();
    await handle(makeReq('GET', `/overdue-reminders/${id}`), res, `/overdue-reminders/${id}`);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { id: string }).id).toBe(id);

    const missing = makeRes();
    await handle(
      makeReq('GET', '/overdue-reminders/nope'),
      missing,
      '/overdue-reminders/nope'
    );
    expect(missing.statusCode).toBe(404);
  });

  it('updates a schedule (200), 404 for unknown id, 400 for invalid stages', async () => {
    const created = makeRes();
    await handle(
      makeReq('POST', '/overdue-reminders', { merchantId: MERCHANT }),
      created,
      '/overdue-reminders'
    );
    const { id } = created.json() as { id: string };

    const updated = makeRes();
    await handle(
      makeReq('PATCH', `/overdue-reminders/${id}`, { enabled: false }),
      updated,
      `/overdue-reminders/${id}`
    );
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { enabled: boolean }).enabled).toBe(false);

    const invalid = makeRes();
    await handle(
      makeReq('PATCH', `/overdue-reminders/${id}`, { stages: [] }),
      invalid,
      `/overdue-reminders/${id}`
    );
    expect(invalid.statusCode).toBe(400);

    const missing = makeRes();
    await handle(
      makeReq('PATCH', '/overdue-reminders/nope', { enabled: true }),
      missing,
      '/overdue-reminders/nope'
    );
    expect(missing.statusCode).toBe(404);
  });

  it('deletes a schedule (204) or 404 for unknown id', async () => {
    const created = makeRes();
    await handle(
      makeReq('POST', '/overdue-reminders', { merchantId: MERCHANT }),
      created,
      '/overdue-reminders'
    );
    const { id } = created.json() as { id: string };

    const res = makeRes();
    await handle(
      makeReq('DELETE', `/overdue-reminders/${id}`),
      res,
      `/overdue-reminders/${id}`
    );
    expect(res.statusCode).toBe(204);

    const missing = makeRes();
    await handle(
      makeReq('DELETE', `/overdue-reminders/${id}`),
      missing,
      `/overdue-reminders/${id}`
    );
    expect(missing.statusCode).toBe(404);
  });

  it('returns 405 for an unsupported method on a single id', async () => {
    const res = makeRes();
    await handle(makeReq('PUT', '/overdue-reminders/abc'), res, '/overdue-reminders/abc');
    expect(res.statusCode).toBe(405);
  });
});

// ─── Entries ──────────────────────────────────────────────────────────────────

describe('overdueInvoiceReminderRouter — entries', () => {
  it('lists entries and honours the status filter', async () => {
    service.createSchedule({ merchantId: MERCHANT });
    await service.runDue(() => [makeInvoice()]);

    const all = makeRes();
    await handle(makeReq('GET', '/overdue-reminders/entries'), all, '/overdue-reminders/entries');
    expect(all.statusCode).toBe(200);
    expect(all.json() as unknown[]).toHaveLength(1);

    const stopped = makeRes();
    await handle(
      makeReq('GET', '/overdue-reminders/entries?status=stopped'),
      stopped,
      '/overdue-reminders/entries'
    );
    expect(stopped.statusCode).toBe(200);
    expect(stopped.json() as unknown[]).toHaveLength(0);

    const invalid = makeRes();
    await handle(
      makeReq('GET', '/overdue-reminders/entries?status=bogus'),
      invalid,
      '/overdue-reminders/entries'
    );
    expect(invalid.statusCode).toBe(400);
  });
});

// ─── run-now and stop ─────────────────────────────────────────────────────────

describe('overdueInvoiceReminderRouter — run-now and stop', () => {
  it('runs a pass against the configured source (200)', async () => {
    service.createSchedule({ merchantId: MERCHANT });
    const res = makeRes();
    await handle(
      makeReq('POST', '/overdue-reminders/run-now'),
      res,
      '/overdue-reminders/run-now'
    );
    expect(res.statusCode).toBe(200);
    expect((res.json() as { invoicesConsidered: number }).invoicesConsidered).toBe(1);
  });

  it('returns 503 when no source is configured', async () => {
    const bare = createOverdueInvoiceReminderRouter(makeService());
    const res = makeRes();
    await bare(makeReq('POST', '/overdue-reminders/run-now'), res, '/overdue-reminders/run-now');
    expect(res.statusCode).toBe(503);
  });

  it('stops reminders for an invoice (200) or 404 when none are active', async () => {
    service.createSchedule({ merchantId: MERCHANT });
    await service.runDue(() => [makeInvoice()]);

    const res = makeRes();
    await handle(
      makeReq('POST', '/overdue-reminders/invoices/inv_1001/stop'),
      res,
      '/overdue-reminders/invoices/inv_1001/stop'
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ invoiceId: 'inv_1001', stopped: true, reason: 'paid' });

    const again = makeRes();
    await handle(
      makeReq('POST', '/overdue-reminders/invoices/inv_1001/stop'),
      again,
      '/overdue-reminders/invoices/inv_1001/stop'
    );
    expect(again.statusCode).toBe(404);
  });

  it('accepts an explicit reason and rejects unknown ones', async () => {
    service.createSchedule({ merchantId: MERCHANT });
    await service.runDue(() => [makeInvoice()]);

    const res = makeRes();
    await handle(
      makeReq('POST', '/overdue-reminders/invoices/inv_1001/stop', { reason: 'voided' }),
      res,
      '/overdue-reminders/invoices/inv_1001/stop'
    );
    expect(res.statusCode).toBe(200);
    expect((res.json() as { reason: string }).reason).toBe('voided');

    const invalid = makeRes();
    await handle(
      makeReq('POST', '/overdue-reminders/invoices/inv_1002/stop', { reason: 'exploded' }),
      invalid,
      '/overdue-reminders/invoices/inv_1002/stop'
    );
    expect(invalid.statusCode).toBe(400);
  });
});
