/**
 * Tests for DeliveryStatusScreen (#1749)
 *
 * Drives the real deliveryReceiptsStore (with a mocked apiClient) and asserts
 * the per-channel summary, the receipt timeline, the empty state and the
 * refresh action.
 */

import React from 'react';

import { render, fireEvent, waitFor } from '../../test-utils';
import DeliveryStatusScreen from '../DeliveryStatusScreen';
import { apiClient } from '../../services/network/apiClient';
import { useDeliveryReceiptsStore, emptySummary } from '../../store/deliveryReceiptsStore';
import type { ApiResponse } from '../../services/network/apiClient';

jest.mock('../../services/network/apiClient', () => ({
  apiClient: { request: jest.fn() },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

const mockRequest = apiClient.request as jest.MockedFunction<typeof apiClient.request>;
const ok = <T,>(data: T): ApiResponse<T> => ({ status: 200, ok: true, data, traceId: 't' });

const summary = (userId: string) => ({
  ...emptySummary(userId),
  total: 1,
  counts: { ...emptySummary(userId).counts, delivered: 1 },
  byChannel: {
    ...emptySummary(userId).byChannel,
    sms: {
      channel: 'sms' as const,
      receiptId: 'r1',
      status: 'delivered' as const,
      updatedAt: '2026-03-15T10:05:00Z',
    },
  },
});

const receipt = {
  id: 'r1',
  userId: 'u1',
  type: 'renewal_reminder',
  channel: 'sms' as const,
  providerMessageId: 'SM123',
  status: 'delivered' as const,
  events: [
    { status: 'sent' as const, at: '2026-03-15T10:00:00Z' },
    { status: 'delivered' as const, at: '2026-03-15T10:05:00Z' },
  ],
  createdAt: '2026-03-15T10:00:00Z',
  updatedAt: '2026-03-15T10:05:00Z',
};

beforeEach(() => {
  mockRequest.mockReset();
  useDeliveryReceiptsStore.getState().reset();
});

describe('DeliveryStatusScreen', () => {
  it('renders the per-channel summary and the receipt timeline', async () => {
    mockRequest.mockResolvedValueOnce(ok(summary('u1'))).mockResolvedValueOnce(ok([receipt]));

    const screen = render(<DeliveryStatusScreen userId="u1" />);

    await waitFor(() => expect(screen.getByTestId('delivery-summary')).toBeTruthy());
    expect(screen.getByTestId('delivery-channel-status-sms')).toBeTruthy();
    expect(screen.getByTestId('delivery-channel-status-email')).toBeFalsy();
    expect(screen.getByTestId('delivery-status-r1')).toBeTruthy();
    expect(screen.getAllByText('Delivered').length).toBeGreaterThan(0);
  });

  it('shows the empty state when there are no receipts', async () => {
    mockRequest.mockResolvedValueOnce(ok(emptySummary('u1'))).mockResolvedValueOnce(ok([]));

    const screen = render(<DeliveryStatusScreen userId="u1" />);

    await waitFor(() => expect(screen.getByTestId('delivery-empty')).toBeTruthy());
  });

  it('refreshes on demand', async () => {
    mockRequest.mockResolvedValueOnce(ok(emptySummary('u1'))).mockResolvedValueOnce(ok([]));
    const screen = render(<DeliveryStatusScreen userId="u1" />);
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(2));

    mockRequest.mockResolvedValueOnce(ok(summary('u1'))).mockResolvedValueOnce(ok([receipt]));
    fireEvent.press(screen.getByTestId('delivery-refresh'));

    await waitFor(() => expect(screen.getByTestId('delivery-status-r1')).toBeTruthy());
  });

  it('shows an error banner when the API fails', async () => {
    mockRequest.mockRejectedValue(new Error('offline'));
    const screen = render(<DeliveryStatusScreen userId="u1" />);
    await waitFor(() => expect(screen.getByTestId('delivery-error')).toBeTruthy());
    expect(screen.getByText('offline')).toBeTruthy();
  });
});
