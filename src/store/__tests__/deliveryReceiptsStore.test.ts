/**
 * Tests for deliveryReceiptsStore (#1749)
 *
 * The store is a thin read-through cache over the delivery-receipts API; these
 * tests drive the real store with a mocked `apiClient` and assert the fetch,
 * caching, error and reset behaviour.
 */

import { apiClient } from '../../services/network/apiClient';
import {
  useDeliveryReceiptsStore,
  emptySummary,
  STATUS_PRESENTATION,
} from '../deliveryReceiptsStore';
import type { ApiResponse } from '../../services/network/apiClient';

jest.mock('../../services/network/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));

const mockRequest = apiClient.request as jest.MockedFunction<typeof apiClient.request>;

const ok = <T>(data: T): ApiResponse<T> => ({ status: 200, ok: true, data, traceId: 't' });

const summary = (userId: string) => ({
  ...emptySummary(userId),
  total: 1,
  counts: { ...emptySummary(userId).counts, sent: 1 },
  byChannel: {
    ...emptySummary(userId).byChannel,
    sms: {
      channel: 'sms' as const,
      receiptId: 'r1',
      status: 'sent' as const,
      updatedAt: '2026-03-15T10:00:00Z',
    },
  },
});

const receipt = (id: string) => ({
  id,
  userId: 'u1',
  type: 'renewal_reminder',
  channel: 'sms' as const,
  status: 'sent' as const,
  events: [{ status: 'sent' as const, at: '2026-03-15T10:00:00Z' }],
  createdAt: '2026-03-15T10:00:00Z',
  updatedAt: '2026-03-15T10:00:00Z',
});

const store = () => useDeliveryReceiptsStore.getState();

beforeEach(() => {
  mockRequest.mockReset();
  store().reset();
});

describe('deliveryReceiptsStore.refresh', () => {
  it('loads the summary and receipts for a user', async () => {
    mockRequest.mockResolvedValueOnce(ok(summary('u1'))).mockResolvedValueOnce(ok([receipt('r1')]));

    await store().refresh('u1');

    expect(store().userId).toBe('u1');
    expect(store().summary.total).toBe(1);
    expect(store().summary.byChannel.sms.status).toBe('sent');
    expect(store().receipts).toHaveLength(1);
    expect(store().loading).toBe(false);
    expect(store().error).toBeNull();
  });

  it('records an error when the API responds non-ok', async () => {
    mockRequest
      .mockResolvedValueOnce({ status: 500, ok: false, data: null as never, traceId: 't' })
      .mockResolvedValueOnce(ok([]));

    await store().refresh('u1');

    expect(store().loading).toBe(false);
    expect(store().error).toContain('500');
  });

  it('records an error when the request throws', async () => {
    mockRequest.mockRejectedValueOnce(new Error('offline'));
    await store().refresh('u1');
    expect(store().error).toBe('offline');
  });
});

describe('deliveryReceiptsStore.loadReceipt', () => {
  it('serves a cached receipt without hitting the API', async () => {
    mockRequest.mockResolvedValueOnce(ok(receipt('r1'))).mockResolvedValueOnce(ok([receipt('r1')]));
    await store().refresh('u1');
    mockRequest.mockClear();

    const found = await store().loadReceipt('r1');

    expect(found?.id).toBe('r1');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('fetches an unseen receipt and caches it', async () => {
    mockRequest.mockResolvedValueOnce(ok(receipt('r2')));
    const found = await store().loadReceipt('r2');
    expect(found?.id).toBe('r2');
    expect(store().receipts[0]?.id).toBe('r2');
  });

  it('returns null when the receipt is unknown', async () => {
    mockRequest.mockResolvedValueOnce({
      status: 404,
      ok: false,
      data: null as never,
      traceId: 't',
    });
    expect(await store().loadReceipt('missing')).toBeNull();
  });
});

describe('status presentation', () => {
  it('labels every status with a tone', () => {
    expect(STATUS_PRESENTATION.delivered).toMatchObject({ label: 'Delivered', tone: 'positive' });
    expect(STATUS_PRESENTATION.failed.tone).toBe('negative');
    expect(STATUS_PRESENTATION.sent.tone).toBe('pending');
  });
});
