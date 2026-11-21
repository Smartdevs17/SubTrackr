import { createWalletConnectFlow, isWalletSession } from '../connectFlow';
import type { WalletAdapter, WalletSession, WalletStorage } from '../types';

const STELLAR_KEY = `G${'A'.repeat(55)}`;
const EVM_ADDRESS = `0x${'1'.repeat(40)}`;

function makeStorage(): WalletStorage {
  const values = new Map<string, string>();
  return {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      values.delete(key);
    }),
  };
}

function adapter(
  kind: WalletAdapter['kind'],
  address: string,
  overrides: Partial<WalletAdapter> = {}
): WalletAdapter {
  return {
    kind,
    connect: jest.fn(async () => ({
      kind,
      account: { address, network: kind === 'freighter' ? 'stellar' : 'evm' },
      connectedAt: 10,
    })),
    disconnect: jest.fn(async () => undefined),
    ...overrides,
  };
}

function makeFlow(adapters: WalletAdapter[], storage?: WalletStorage) {
  const metrics = { increment: jest.fn(), timing: jest.fn() };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const flow = createWalletConnectFlow({ adapters, storage, metrics, logger, now: () => 99 });
  return { flow, metrics, logger };
}

describe('isWalletSession', () => {
  it('accepts valid sessions and rejects malformed ones', () => {
    const valid: WalletSession = {
      kind: 'freighter',
      account: { address: STELLAR_KEY, network: 'stellar' },
      connectedAt: 1,
    };
    expect(isWalletSession(valid)).toBe(true);
    expect(isWalletSession({ ...valid, account: { ...valid.account, address: 'bad' } })).toBe(
      false
    );
    expect(isWalletSession({ ...valid, connectedAt: 'now' })).toBe(false);
    expect(isWalletSession(null)).toBe(false);
  });
});

describe('createWalletConnectFlow', () => {
  it('connects, persists and emits connected state', async () => {
    const storage = makeStorage();
    const freighter = adapter('freighter', STELLAR_KEY);
    const { flow, metrics } = makeFlow([freighter], storage);
    const states: string[] = [];
    flow.subscribe((state) => states.push(state.status));

    const session = await flow.connect('freighter');

    expect(freighter.connect).toHaveBeenCalledTimes(1);
    expect(session.kind).toBe('freighter');
    expect(flow.getState()).toMatchObject({ status: 'connected', isConnecting: false });
    expect(states).toEqual(['disconnected', 'connecting', 'connected']);
    expect(storage.setItem).toHaveBeenCalledWith(
      '@subtrackr_wallet_session',
      JSON.stringify(session)
    );
    expect(metrics.increment).toHaveBeenCalledWith('subtrackr.wallet.connected', 1, {
      kind: 'freighter',
      network: 'stellar',
    });
  });

  it('rejects unknown adapters and concurrent connects', async () => {
    const { flow } = makeFlow([adapter('freighter', STELLAR_KEY)]);
    await expect(flow.connect('walletconnect-v2')).rejects.toMatchObject({
      code: 'ADAPTER_NOT_FOUND',
    });

    let release: (() => void) | undefined;
    const slow = adapter('freighter', STELLAR_KEY, {
      connect: jest.fn(
        () =>
          new Promise<WalletSession>((resolve) => {
            release = () =>
              resolve({
                kind: 'freighter',
                account: { address: STELLAR_KEY, network: 'stellar' },
                connectedAt: 1,
              });
          })
      ),
    });
    const concurrent = makeFlow([slow]).flow;
    const first = concurrent.connect('freighter');
    await expect(concurrent.connect('freighter')).rejects.toMatchObject({
      code: 'CONNECT_IN_PROGRESS',
    });
    release?.();
    await first;
  });

  it('normalises connection failures into state and metrics', async () => {
    const failing = adapter('walletconnect-v2', EVM_ADDRESS, {
      connect: jest.fn(async () => {
        throw new Error('Connector exploded');
      }),
    });
    const { flow, metrics, logger } = makeFlow([failing]);

    await expect(flow.connect('walletconnect-v2')).rejects.toMatchObject({
      code: 'CONNECT_FAILED',
    });
    expect(flow.getState()).toMatchObject({ status: 'error', error: 'Connector exploded' });
    expect(metrics.increment).toHaveBeenCalledWith('subtrackr.wallet.connect_failed', 1, {
      kind: 'walletconnect-v2',
      code: 'CONNECT_FAILED',
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('restores a persisted session through the adapter', async () => {
    const storage = makeStorage();
    const stellar = adapter('freighter', STELLAR_KEY);
    const { flow } = makeFlow([stellar], storage);
    const session = await flow.connect('freighter');
    const restored = makeFlow(
      [
        adapter('freighter', STELLAR_KEY, {
          restore: jest.fn(async (candidate: WalletSession) => candidate),
        }),
      ],
      storage
    );
    const restoredFlow = restored.flow;

    expect(await restoredFlow.restore()).toEqual(session);
    expect(restoredFlow.getState().status).toBe('connected');
    expect(restored.metrics.increment).toHaveBeenCalledWith('subtrackr.wallet.restored', 1, {
      kind: 'freighter',
    });
  });

  it('clears an invalid stored session', async () => {
    const storage = makeStorage();
    await storage.setItem('@subtrackr_wallet_session', '{not-json');
    const { flow } = makeFlow([adapter('freighter', STELLAR_KEY)], storage);

    expect(await flow.restore()).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith('@subtrackr_wallet_session');
    expect(flow.getState().status).toBe('disconnected');
  });

  it('drops a session the adapter no longer considers active', async () => {
    const storage = makeStorage();
    const { flow } = makeFlow([adapter('freighter', STELLAR_KEY)], storage);
    await flow.connect('freighter');
    const staleFlow = makeFlow(
      [
        adapter('freighter', STELLAR_KEY, {
          restore: jest.fn(async () => null),
        }),
      ],
      storage
    ).flow;

    expect(await staleFlow.restore()).toBeNull();
    expect(storage.removeItem).toHaveBeenCalled();
  });

  it('disconnects and clears the persisted session', async () => {
    const storage = makeStorage();
    const freighter = adapter('freighter', STELLAR_KEY);
    const { flow, metrics } = makeFlow([freighter], storage);
    await flow.connect('freighter');

    await flow.disconnect();

    expect(freighter.disconnect).toHaveBeenCalledTimes(1);
    expect(storage.removeItem).toHaveBeenCalled();
    expect(flow.getState()).toEqual({
      status: 'disconnected',
      session: null,
      error: null,
      isConnecting: false,
    });
    expect(metrics.increment).toHaveBeenCalledWith('subtrackr.wallet.disconnected', 1, {
      kind: 'freighter',
    });
  });
});
