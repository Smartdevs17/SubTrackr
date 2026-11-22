import { act } from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ExecuteOrQueueResult, useTransactionQueueStore } from '../transactionQueueStore';

const mockCreateSuperfluidStream =
  jest.fn<(...args: unknown[]) => Promise<{ streamId: string; txHash: string }>>();
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
    createSuperfluidStream: (...args: unknown[]) =>
      mockCreateSuperfluidStream(...args) as Promise<{ streamId: string; txHash: string }>,
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
    });

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

  it('measures staleness from the last attempt, not creation', async () => {
    // A transaction that keeps retrying is still making progress, so it must
    // not be expired purely because it was created over 30 minutes ago.
    const oldCreation = Date.now() - 31 * 60 * 1000;
    const recentAttempt = Date.now() - 5_000;

    mockCreateSuperfluidStream.mockResolvedValue({ streamId: 'stream:1', txHash: '0xhash' });

    useTransactionQueueStore.setState({
      queuedTransactions: [
        {
          id: 'retrying_tx',
          createdAt: oldCreation,
          updatedAt: recentAttempt,
          lastAttemptAt: recentAttempt,
          attempts: 1,
          conflictKey: 'superfluid:137:usdc:0x1111111111111111111111111111111111111111',
          status: 'pending',
          payload: samplePayload,
        },
      ],
    });

    await act(async () => {
      await useTransactionQueueStore.getState().processQueue();
    });

    expect(mockCreateSuperfluidStream).toHaveBeenCalledTimes(1);
  });

  it('records the broadcast marker before handing the payload to the wallet', async () => {
    let broadcastedAtSeenDuringExecution: number | undefined;

    mockCreateSuperfluidStream.mockImplementation(async () => {
      // Inspect persisted state mid-flight: the marker must already be set,
      // otherwise a crash here would cause a duplicate charge on restart.
      const [entry] = useTransactionQueueStore.getState().queuedTransactions;
      broadcastedAtSeenDuringExecution = entry?.broadcastedAt;
      return { streamId: 'stream:1', txHash: '0xhash' };
    });

    await act(async () => {
      await useTransactionQueueStore.getState().queueTransaction(samplePayload);
      await useTransactionQueueStore.getState().processQueue();
    });

    expect(broadcastedAtSeenDuringExecution).toEqual(expect.any(Number));
    expect(useTransactionQueueStore.getState().queuedTransactions).toHaveLength(0);
  });

  it('retires a transaction whose outcome is unknown instead of re-broadcasting it', async () => {
    // `broadcastedAt` in the past plus no receipt means the wallet may have
    // already submitted it. Re-sending would charge the user twice.
    const longAgo = Date.now() - 20 * 60 * 1000;

    useTransactionQueueStore.setState({
      queuedTransactions: [
        {
          id: 'in_flight_tx',
          createdAt: longAgo,
          updatedAt: longAgo,
          lastAttemptAt: longAgo,
          broadcastedAt: longAgo,
          attempts: 1,
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
    expect(useTransactionQueueStore.getState().lastError).toMatch(/submitted before/i);
  });

  it('defers a retry until its backoff window has elapsed', async () => {
    const now = Date.now();

    mockCreateSuperfluidStream.mockRejectedValue(new Error('execution failed'));

    useTransactionQueueStore.setState({
      queuedTransactions: [
        {
          id: 'backoff_tx',
          createdAt: now - 1000,
          updatedAt: now - 1000,
          attempts: 1,
          conflictKey: 'superfluid:137:usdc:0x1111111111111111111111111111111111111111',
          status: 'pending',
          payload: samplePayload,
          nextAttemptAt: now + 60_000,
        },
      ],
    });

    await act(async () => {
      await useTransactionQueueStore.getState().processQueue();
    });

    expect(mockCreateSuperfluidStream).not.toHaveBeenCalled();
    expect(useTransactionQueueStore.getState().queuedTransactions).toHaveLength(1);
  });

  it('schedules a backoff after a failed attempt', async () => {
    mockCreateSuperfluidStream.mockRejectedValue(new Error('execution failed'));

    const before = Date.now();
    await act(async () => {
      await useTransactionQueueStore.getState().queueTransaction(samplePayload);
      await useTransactionQueueStore.getState().processQueue();
    });

    const [entry] = useTransactionQueueStore.getState().queuedTransactions;
    expect(entry?.nextAttemptAt).toBeGreaterThan(before);
  });

  it('keeps the broadcast marker after an ambiguous failure', async () => {
    // A generic failure does not prove the transaction never reached the
    // network, so the marker must survive to prevent a double charge.
    mockCreateSuperfluidStream.mockRejectedValue(new Error('execution failed'));

    await act(async () => {
      await useTransactionQueueStore.getState().queueTransaction(samplePayload);
      await useTransactionQueueStore.getState().processQueue();
    });

    const [entry] = useTransactionQueueStore.getState().queuedTransactions;
    expect(entry?.broadcastedAt).toEqual(expect.any(Number));
  });

  it('clears the broadcast marker when the wallet provably rejected the request', async () => {
    mockCreateSuperfluidStream.mockRejectedValue(
      Object.assign(new Error('Transaction was rejected in your wallet.'), {
        code: 'USER_REJECTED',
      })
    );

    await act(async () => {
      await useTransactionQueueStore.getState().queueTransaction(samplePayload);
      await useTransactionQueueStore.getState().processQueue();
    });

    const [entry] = useTransactionQueueStore.getState().queuedTransactions;
    // Nothing was submitted, so an immediate retry is safe.
    expect(entry?.broadcastedAt).toBeUndefined();
  });

  it('keeps the connectivity listener alive while another consumer is mounted', async () => {
    const unsubscribeFirst = useTransactionQueueStore.getState().initializeConnectivityListener();
    const unsubscribeSecond = useTransactionQueueStore.getState().initializeConnectivityListener();

    unsubscribeFirst();

    // The second consumer is still mounted, so tearing down must not happen.
    expect(() => unsubscribeSecond()).not.toThrow();
  });
});
