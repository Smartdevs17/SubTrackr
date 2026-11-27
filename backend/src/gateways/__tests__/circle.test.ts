import crypto from 'crypto';
import type { BillingTransport } from '../billingAdapter';
import {
  InMemoryCircleLedger,
  applyCircleEvent,
  createCircleAdapter,
  decimalStringToMicro,
  microToDecimalString,
  normaliseCircleStatus,
  reconcileCirclePayments,
  verifyCircleWebhook,
  type CirclePayment,
} from '../circle';

type Reply = { status: number; body: Record<string, unknown> } | Error;

function fake(replies: Reply[]) {
  const calls: any[] = [];
  const transport: BillingTransport = {
    async request(req) {
      calls.push(req);
      const next = replies.shift();
      if (!next) throw new Error('unexpected request');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { transport, calls };
}
const retry = { sleep: async () => undefined, baseDelayMs: 0 };
const wire = (id: string, status: string, amount: string) => ({
  status: 200,
  body: { data: { id, status, amount: { amount, currency: 'USD' }, createDate: '2026-01-01T00:00:00Z' } },
});
const payment = (id: string, status: CirclePayment['status'], amountMicro: number): CirclePayment => ({
  paymentId: id, status, amountMicro, createdAt: '2026-01-01T00:00:00Z',
});

describe('amount conversion', () => {
  it.each([
    [1_500_000, '1.500000'],
    [1, '0.000001'],
    [10_000_000, '10.000000'],
  ])('micro %i -> %s', (micro, text) => {
    expect(microToDecimalString(micro)).toBe(text);
    expect(decimalStringToMicro(text)).toBe(micro);
  });
  it('parses short decimals and rejects junk', () => {
    expect(decimalStringToMicro('1.5')).toBe(1_500_000);
    expect(decimalStringToMicro('7')).toBe(7_000_000);
    for (const bad of ['1.1234567', '-1', 'abc', '', undefined, 5]) {
      expect(() => decimalStringToMicro(bad)).toThrow(/invalid USDC amount/);
    }
  });
  it('maps provider statuses', () => {
    expect(normaliseCircleStatus('complete')).toBe('paid');
    expect(normaliseCircleStatus('cancelled')).toBe('failed');
    expect(normaliseCircleStatus('confirmed')).toBe('confirmed');
    expect(normaliseCircleStatus('whatever')).toBe('pending');
  });
});

describe('createCircleAdapter', () => {
  it('creates a payment with the idempotency key and decimal amount', async () => {
    const { transport, calls } = fake([wire('pay_1', 'pending', '2.500000')]);
    const adapter = createCircleAdapter({ transport, retry });
    const result = await adapter.createPayment({ idempotencyKey: 'k1', amountMicro: 2_500_000, sourceId: 'w1', metadata: { sub: 's1' } });
    expect(result).toEqual(payment('pay_1', 'pending', 2_500_000));
    expect(calls[0]).toMatchObject({
      method: 'POST', path: '/v1/payments', idempotencyKey: 'k1',
      body: { amount: { amount: '2.500000', currency: 'USD' }, source: { id: 'w1', type: 'wallet' }, metadata: { sub: 's1' } },
    });
  });

  it('retries 429/5xx/transport errors with the same key; not 4xx', async () => {
    const { transport, calls } = fake([
      { status: 429, body: {} }, new Error('ECONNRESET'), { status: 503, body: {} }, wire('pay_1', 'pending', '1'),
    ]);
    const adapter = createCircleAdapter({ transport, retry: { ...retry, maxAttempts: 4 } });
    await adapter.createPayment({ idempotencyKey: 'same', amountMicro: 1_000_000, sourceId: 'w1' });
    expect(calls.map((c) => c.idempotencyKey)).toEqual(['same', 'same', 'same', 'same']);

    const rejected = fake([{ status: 400, body: { message: 'bad source' } }]);
    await expect(
      createCircleAdapter({ transport: rejected.transport, retry }).createPayment({ idempotencyKey: 'k', amountMicro: 1, sourceId: 'x' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_REJECTED', message: 'bad source', provider: 'circle' });
    expect(rejected.calls).toHaveLength(1);
  });

  it('validates input and responses', async () => {
    const { transport, calls } = fake([{ status: 200, body: { data: { status: 'pending' } } }]);
    const adapter = createCircleAdapter({ transport, retry });
    for (const bad of [
      { idempotencyKey: '', amountMicro: 1, sourceId: 's' },
      { idempotencyKey: 'k', amountMicro: 0, sourceId: 's' },
      { idempotencyKey: 'k', amountMicro: 1.5, sourceId: 's' },
      { idempotencyKey: 'k', amountMicro: 1, sourceId: '' },
    ]) {
      await expect(adapter.createPayment(bad)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    expect(calls).toHaveLength(0);
    await expect(adapter.fetchPayment('pay_x')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('records telemetry', async () => {
    const events: any[] = [];
    const { transport } = fake([wire('p', 'paid', '1'), { status: 404, body: {} }]);
    const adapter = createCircleAdapter({ transport, retry, telemetry: { record: (e) => events.push(e) } });
    await adapter.fetchPayment('p');
    await expect(adapter.fetchPayment('nope')).rejects.toMatchObject({ code: 'UNKNOWN' });
    expect(events.map((e) => [e.operation, e.provider, e.outcome, e.errorCode])).toEqual([
      ['fetch', 'circle', 'success', undefined],
      ['fetch', 'circle', 'failure', 'UNKNOWN'],
    ]);
  });
});

describe('verifyCircleWebhook', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const body = JSON.stringify({ notificationId: 'n1' });
  const sign = (b: string, key = privateKey) => crypto.sign('sha256', Buffer.from(b), key).toString('base64');
  const resolve = (id: string) => (id === 'key-1' ? pem : undefined);

  it('accepts a valid signature (string or Buffer body)', () => {
    const headers = { 'x-circle-signature': sign(body), 'x-circle-key-id': 'key-1' };
    expect(verifyCircleWebhook(body, headers, resolve)).toEqual({ valid: true, keyId: 'key-1' });
    expect(verifyCircleWebhook(Buffer.from(body), headers, resolve).valid).toBe(true);
  });

  it('rejects tampering, wrong key, unknown key id and missing/garbage headers', () => {
    const good = { 'x-circle-signature': sign(body), 'x-circle-key-id': 'key-1' };
    expect(verifyCircleWebhook(body + ' ', good, resolve).valid).toBe(false);
    const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    expect(verifyCircleWebhook(body, { ...good, 'x-circle-signature': sign(body, other) }, resolve).valid).toBe(false);
    expect(verifyCircleWebhook(body, { ...good, 'x-circle-key-id': 'key-2' }, resolve).error).toMatch(/Unknown signing key/);
    expect(verifyCircleWebhook(body, { 'x-circle-key-id': 'key-1' }, resolve).error).toMatch(/Missing x-circle-signature/);
    expect(verifyCircleWebhook(body, { 'x-circle-signature': 'x' }, resolve).error).toMatch(/Missing x-circle-key-id/);
    expect(verifyCircleWebhook(body, { ...good, 'x-circle-signature': '!!!' }, resolve).valid).toBe(false);
    expect(verifyCircleWebhook(body, { ...good, 'x-circle-signature': [good['x-circle-signature']] }, resolve).valid).toBe(true);
  });
});

describe('applyCircleEvent', () => {
  async function seeded() {
    const ledger = new InMemoryCircleLedger();
    await ledger.put({ paymentId: 'p1', status: 'pending', expectedAmountMicro: 5_000_000, updatedAt: '2026-01-01T00:00:00.000Z' });
    return ledger;
  }
  const logger = () => ({ info: jest.fn(), warn: jest.fn() });

  it('moves a payment forward and logs it', async () => {
    const ledger = await seeded();
    const log = logger();
    expect(await applyCircleEvent(ledger, { notificationId: 'n1', payment: payment('p1', 'paid', 5_000_000) }, log, () => 'T')).toBe('applied');
    expect(await ledger.get('p1')).toMatchObject({ status: 'paid', updatedAt: 'T' });
    expect(log.info).toHaveBeenCalledWith('[circle] payment updated', { paymentId: 'p1', from: 'pending', to: 'paid' });
  });

  it('is idempotent per notification id', async () => {
    const ledger = await seeded();
    const event = { notificationId: 'n1', payment: payment('p1', 'confirmed', 5_000_000) };
    expect(await applyCircleEvent(ledger, event)).toBe('applied');
    expect(await applyCircleEvent(ledger, event)).toBe('duplicate');
  });

  it('ignores out-of-order and post-terminal events', async () => {
    const ledger = await seeded();
    await applyCircleEvent(ledger, { notificationId: 'a', payment: payment('p1', 'paid', 5_000_000) });
    expect(await applyCircleEvent(ledger, { notificationId: 'b', payment: payment('p1', 'confirmed', 5_000_000) })).toBe('ignored_stale');
    expect(await applyCircleEvent(ledger, { notificationId: 'c', payment: payment('p1', 'failed', 5_000_000) })).toBe('ignored_stale');
    expect((await ledger.get('p1'))!.status).toBe('paid');
  });

  it('flags amount mismatches and unknown payments without changing the ledger', async () => {
    const ledger = await seeded();
    const log = logger();
    expect(await applyCircleEvent(ledger, { notificationId: 'm', payment: payment('p1', 'paid', 1) }, log)).toBe('amount_mismatch');
    expect(await applyCircleEvent(ledger, { notificationId: 'u', payment: payment('nope', 'paid', 1) }, log)).toBe('unknown_payment');
    expect((await ledger.get('p1'))!.status).toBe('pending');
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it('requires a notification id', async () => {
    await expect(applyCircleEvent(await seeded(), { notificationId: '', payment: payment('p1', 'paid', 1) })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

describe('reconcileCirclePayments', () => {
  const NOW = Date.parse('2026-01-02T00:00:00.000Z');

  it('updates stale unsettled payments, reports mismatches and isolates errors', async () => {
    const ledger = new InMemoryCircleLedger();
    const old = '2026-01-01T00:00:00.000Z';
    for (const id of ['ok', 'mismatch', 'boom', 'unchanged']) {
      await ledger.put({ paymentId: id, status: 'pending', expectedAmountMicro: 1_000_000, updatedAt: old });
    }
    await ledger.put({ paymentId: 'fresh', status: 'pending', expectedAmountMicro: 1_000_000, updatedAt: '2026-01-01T23:59:59.000Z' });
    await ledger.put({ paymentId: 'done', status: 'paid', expectedAmountMicro: 1_000_000, updatedAt: old });

    const fetched: string[] = [];
    const adapter = {
      createPayment: jest.fn(),
      fetchPayment: jest.fn(async (id: string) => {
        fetched.push(id);
        if (id === 'boom') throw new Error('circle down');
        if (id === 'mismatch') return payment(id, 'paid', 2_000_000);
        if (id === 'unchanged') return payment(id, 'pending', 1_000_000);
        return payment(id, 'paid', 1_000_000);
      }),
    };
    const log = { info: jest.fn(), warn: jest.fn() };
    const report = await reconcileCirclePayments({ ledger, adapter, staleAfterMs: 60_000, nowMs: NOW, logger: log });

    expect(fetched.sort()).toEqual(['boom', 'mismatch', 'ok', 'unchanged']);
    expect(report).toEqual({
      checked: 4,
      updated: ['ok'],
      mismatched: ['mismatch'],
      errors: [{ paymentId: 'boom', error: 'circle down' }],
    });
    expect((await ledger.get('ok'))!.status).toBe('paid');
    expect((await ledger.get('mismatch'))!.status).toBe('pending');
    expect(log.info).toHaveBeenCalledWith('[circle] reconciliation complete', { checked: 4, updated: 1, mismatched: 1, errors: 1 });
  });

  it('is a no-op when nothing is unsettled', async () => {
    const adapter = { createPayment: jest.fn(), fetchPayment: jest.fn() };
    const report = await reconcileCirclePayments({ ledger: new InMemoryCircleLedger(), adapter, staleAfterMs: 1 });
    expect(report).toEqual({ checked: 0, updated: [], mismatched: [], errors: [] });
    expect(adapter.fetchPayment).not.toHaveBeenCalled();
  });
});
