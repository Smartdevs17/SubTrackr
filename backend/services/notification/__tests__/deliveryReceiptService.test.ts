/**
 * Delivery receipts (#1749) — service + transport decorator.
 */

import {
  DeliveryReceiptService,
  InMemoryDeliveryReceiptRepository,
  canTransition,
  normalizeProviderStatus,
} from '../deliveryReceiptService';
import { withDeliveryReceipts, PROVIDER_MESSAGE_ID_KEY } from '../deliveryReceiptTransport';

function makeService(): DeliveryReceiptService {
  let tick = 0;
  const base = Date.UTC(2026, 2, 1, 12, 0, 0);
  return new DeliveryReceiptService(
    new InMemoryDeliveryReceiptRepository(),
    () => new Date(base + tick++ * 1000)
  );
}

describe('normalizeProviderStatus', () => {
  it.each([
    ['queued', 'accepted'],
    ['accepted', 'accepted'],
    ['sending', 'sent'],
    ['sent', 'sent'],
    ['delivered', 'delivered'],
    ['failed', 'failed'],
    ['undelivered', 'undelivered'],
    ['expired', 'expired'],
    ['DELIVERED', 'delivered'],
    ['  sent  ', 'sent'],
  ])('maps %s to %s', (raw, expected) => {
    expect(normalizeProviderStatus(raw)).toBe(expected);
  });

  it('returns null for unknown statuses', () => {
    expect(normalizeProviderStatus('read')).toBeNull();
    expect(normalizeProviderStatus('')).toBeNull();
  });
});

describe('canTransition', () => {
  it('allows forward progress', () => {
    expect(canTransition('accepted', 'sent')).toBe(true);
    expect(canTransition('accepted', 'delivered')).toBe(true);
    expect(canTransition('sent', 'delivered')).toBe(true);
    expect(canTransition('sent', 'failed')).toBe(true);
  });

  it('rejects out-of-order and duplicate transitions', () => {
    expect(canTransition('delivered', 'sent')).toBe(false);
    expect(canTransition('delivered', 'delivered')).toBe(false);
    expect(canTransition('failed', 'sent')).toBe(false);
    expect(canTransition('sent', 'accepted')).toBe(false);
  });
});

describe('DeliveryReceiptService.recordAttempt', () => {
  it('records an accepted SMS as sent', async () => {
    const service = makeService();
    const receipt = await service.recordAttempt({
      userId: 'u1',
      type: 'renewal_reminder',
      channel: 'sms',
      providerMessageId: 'SM123',
      accepted: true,
    });

    expect(receipt.status).toBe('sent');
    expect(receipt.providerMessageId).toBe('SM123');
    expect(receipt.events).toHaveLength(1);
    expect(receipt.events[0]!.status).toBe('sent');
  });

  it('records an in-app attempt as delivered immediately', async () => {
    const service = makeService();
    const receipt = await service.recordAttempt({
      userId: 'u1',
      type: 'product_update',
      channel: 'in_app',
      accepted: true,
    });
    expect(receipt.status).toBe('delivered');
  });

  it('records a refused attempt as failed with the error', async () => {
    const service = makeService();
    const receipt = await service.recordAttempt({
      userId: 'u1',
      type: 'charge_failed',
      channel: 'email',
      accepted: false,
      error: 'mailbox unavailable',
    });

    expect(receipt.status).toBe('failed');
    expect(receipt.events[0]!.detail).toBe('mailbox unavailable');
  });
});

describe('DeliveryReceiptService.applyStatusUpdate', () => {
  it('advances a receipt via provider message id', async () => {
    const service = makeService();
    await service.recordAttempt({
      userId: 'u1',
      type: 'renewal_reminder',
      channel: 'sms',
      providerMessageId: 'SM123',
      accepted: true,
    });

    const updated = await service.applyStatusUpdate({
      providerMessageId: 'SM123',
      status: 'delivered',
    });

    expect(updated?.status).toBe('delivered');
    expect(updated?.events.map((e) => e.status)).toEqual(['sent', 'delivered']);
  });

  it('ignores a stale update that would regress the receipt', async () => {
    const service = makeService();
    await service.recordAttempt({
      userId: 'u1',
      type: 'renewal_reminder',
      channel: 'sms',
      providerMessageId: 'SM123',
      accepted: true,
    });
    await service.applyStatusUpdate({ providerMessageId: 'SM123', status: 'delivered' });

    const after = await service.applyStatusUpdate({
      providerMessageId: 'SM123',
      status: 'sent',
    });

    expect(after?.status).toBe('delivered');
    expect(after?.events).toHaveLength(2);
  });

  it('returns null for an unknown message id', async () => {
    const service = makeService();
    expect(await service.applyStatusUpdate({ providerMessageId: 'nope', status: 'delivered' })).toBeNull();
  });

  it('attaches the provider error code on failure', async () => {
    const service = makeService();
    await service.recordAttempt({
      userId: 'u1',
      type: 'renewal_reminder',
      channel: 'sms',
      providerMessageId: 'SM123',
      accepted: true,
    });
    const updated = await service.applyStatusUpdate({
      providerMessageId: 'SM123',
      status: 'undelivered',
      errorCode: '30003',
      detail: 'Provider error code 30003',
    });
    expect(updated?.errorCode).toBe('30003');
    expect(updated?.status).toBe('undelivered');
  });
});

describe('DeliveryReceiptService queries', () => {
  it('lists a user\u2019s receipts newest first and filters by channel', async () => {
    const service = makeService();
    await service.recordAttempt({ userId: 'u1', type: 'renewal_reminder', channel: 'email', accepted: true });
    await service.recordAttempt({ userId: 'u1', type: 'renewal_reminder', channel: 'sms', accepted: true });
    await service.recordAttempt({ userId: 'u2', type: 'renewal_reminder', channel: 'sms', accepted: true });

    const all = await service.listForUser('u1');
    expect(all).toHaveLength(2);
    expect(all[0]!.channel).toBe('sms');

    const smsOnly = await service.listForUser('u1', { channel: 'sms' });
    expect(smsOnly).toHaveLength(1);
  });

  it('summarises latest status per channel with counts', async () => {
    const service = makeService();
    await service.recordAttempt({
      userId: 'u1',
      type: 'renewal_reminder',
      channel: 'sms',
      providerMessageId: 'SM1',
      accepted: true,
    });
    await service.applyStatusUpdate({ providerMessageId: 'SM1', status: 'delivered' });
    await service.recordAttempt({ userId: 'u1', type: 'charge_failed', channel: 'email', accepted: false, error: 'x' });

    const summary = await service.summarize('u1');
    expect(summary.total).toBe(2);
    expect(summary.byChannel.sms.status).toBe('delivered');
    expect(summary.byChannel.email.status).toBe('failed');
    expect(summary.byChannel.push.status).toBeNull();
    expect(summary.counts.delivered).toBe(1);
    expect(summary.counts.failed).toBe(1);
  });

  it('trims a user to the retention cap', async () => {
    const service = makeService();
    for (let i = 0; i < 505; i++) {
      await service.recordAttempt({ userId: 'u1', type: 'product_update', channel: 'email', accepted: true });
    }
    const receipts = await service.listForUser('u1');
    expect(receipts.length).toBeLessThanOrEqual(500);
  });
});

describe('withDeliveryReceipts', () => {
  it('records a receipt and passes through the transport result', async () => {
    const service = makeService();
    const transport = jest.fn().mockResolvedValue(true);
    const wrapped = withDeliveryReceipts('email', transport, service);

    const accepted = await wrapped({
      userId: 'u1',
      channel: 'email',
      subject: 's',
      body: 'b',
      data: { notificationType: 'renewal_reminder', email: 'a@b.c' },
    });

    expect(accepted).toBe(true);
    const [receipt] = await service.listForUser('u1');
    expect(receipt!.type).toBe('renewal_reminder');
    expect(receipt!.status).toBe('sent');
  });

  it('captures a provider message id stashed in the data bag', async () => {
    const service = makeService();
    const transport = jest.fn(async (input: { data?: Record<string, string> }) => {
      if (input.data) input.data[PROVIDER_MESSAGE_ID_KEY] = 'SM999';
      return true;
    });
    const wrapped = withDeliveryReceipts('sms', transport as never, service);

    await wrapped({
      userId: 'u1',
      channel: 'sms',
      subject: 's',
      body: 'b',
      data: { notificationType: 'renewal_reminder', phone: '+1555' },
    });

    const [receipt] = await service.listForUser('u1');
    expect(receipt!.providerMessageId).toBe('SM999');
  });

  it('records a failed receipt and rethrows the transport error', async () => {
    const service = makeService();
    const transport = jest.fn().mockRejectedValue(new Error('twilio down'));
    const wrapped = withDeliveryReceipts('sms', transport, service);

    await expect(
      wrapped({ userId: 'u1', channel: 'sms', subject: 's', body: 'b', data: { notificationType: 'dunning' } })
    ).rejects.toThrow('twilio down');

    const [receipt] = await service.listForUser('u1');
    expect(receipt!.status).toBe('failed');
    expect(receipt!.events[0]!.detail).toBe('twilio down');
  });
});
