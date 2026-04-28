import { act } from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ExecuteOrQueueResult, useTransactionQueueStore } from '../transactionQueueStore';

const mockCreateSuperfluidStream = jest.fn();
const mockCreateSablierStream = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(() => Promise.resolve({ isConnected: true, isInternetReachable: true })),
  },
}));

jest.mock('../../services/notificationService', () => ({
  presentTransactionQueueNotification: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../services/walletService', () => ({
  __esModule: true,
  default: {
    createSuperfluidStream: (...args: unknown[]) => mockCreateSuperfluidStream(...args),
    createSablierStream: (...args: unknown[]) => mockCreateSablierStream(...args),
  },
}));

const samplePayload = {
  protocol: 'superfluid' as const,
  token: 'USDC',
  amount: '12.5',
  recipientAddress: '0x1111111111111111111111111111111111111111',
  chainId: 137,
};

describe('transactionQueueStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    useTransactionQueueStore.setState({
      isOnline: true,
      isProcessing: false,
      queuedTransactions: [],
      lastError: null,
    });
  });

  it('queues transactions while offline', async () => {
    useTransactionQueueStore.setState({ isOnline: false });

    let result: ExecuteOrQueueResult | undefined;
    await act(async () => {
      result = await useTransactionQueueStore.getState().executeOrQueueTransaction(samplePayload);
    });

    expect(result?.queued).toBe(true);
    expect(useTransactionQueueStore.getState().queuedTransactions).toHaveLength(1);
    expect(mockCreateSuperfluidStream).not.toHaveBeenCalled();
  });

  it('replaces conflicting queued transactions', async () => {
    useTransactionQueueStore.setState({ isOnline: false });

    await act(async () => {
      await useTransactionQueueStore.getState().queueTransaction(samplePayload);
      await useTransactionQueueStore.getState().queueTransaction({
        ...samplePayload,
        amount: '20',
      });
    });

    const queued = useTransactionQueueStore.getState().queuedTransactions;
    expect(queued).toHaveLength(1);
    expect(queued[0].payload.amount).toBe('20');
  });

  it('executes pending transactions when online and clears queue', async () => {
    mockCreateSuperfluidStream.mockResolvedValue({
      streamId: 'stream:1',
      txHash: '0xhash',
    } as never);

    await act(async () => {
      await useTransactionQueueStore.getState().queueTransaction(samplePayload);
      await useTransactionQueueStore.getState().processQueue();
    });

    expect(mockCreateSuperfluidStream).toHaveBeenCalledTimes(1);
    expect(useTransactionQueueStore.getState().queuedTransactions).toHaveLength(0);
  });

  it('drops stale transactions during processing', async () => {
    const staleTimestamp = Date.now() - 31 * 60 * 1000;

    useTransactionQueueStore.setState({
      queuedTransactions: [
        {
          id: 'stale_tx',
          createdAt: staleTimestamp,
          updatedAt: staleTimestamp,
          attempts: 0,
          conflictKey: 'superfluid:137:usdc:0x1111111111111111111111111111111111111111',
          status: 'pending',
          payload: samplePayload,
        },
      ],
    });

    await act(async () => {
      await useTransactionQueueStore.getState().processQueue();
    });

    expect(mockCreateSuperfluidStream).not.toHaveBeenCalled();
    expect(useTransactionQueueStore.getState().queuedTransactions).toHaveLength(0);
  });
});
