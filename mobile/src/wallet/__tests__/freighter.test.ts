import {
  WalletConnectionError,
  createFreighterAdapter,
  resolveFreighterProvider,
} from '../freighter';
import type { FreighterProvider } from '../freighter';

const STELLAR_KEY = `G${'A'.repeat(55)}`;

describe('resolveFreighterProvider', () => {
  it('prefers an injected provider', () => {
    const injected = { getPublicKey: jest.fn() };
    expect(resolveFreighterProvider(injected)).toBe(injected);
  });

  it('falls back to a global Freighter injection', () => {
    const globalProvider = { getPublicKey: jest.fn() };
    const scope = globalThis as { freighterApi?: FreighterProvider };
    scope.freighterApi = globalProvider;
    try {
      expect(resolveFreighterProvider()).toBe(globalProvider);
    } finally {
      delete scope.freighterApi;
    }
  });

  it('returns null when no provider exists', () => {
    expect(resolveFreighterProvider(null)).toBeNull();
  });
});

describe('createFreighterAdapter', () => {
  it('connects and normalises the Stellar account', async () => {
    const provider: FreighterProvider = {
      connect: jest.fn(async () => STELLAR_KEY),
      getNetwork: jest.fn(async () => 'testnet'),
    };
    const adapter = createFreighterAdapter({ provider, now: () => 500 });

    const session = await adapter.connect();

    expect(session).toEqual({
      kind: 'freighter',
      account: {
        address: STELLAR_KEY,
        publicKey: STELLAR_KEY,
        network: 'stellar',
        chainId: 'testnet',
      },
      connectedAt: 500,
    });
  });

  it('falls back to getPublicKey when connect returns nothing', async () => {
    const provider: FreighterProvider = {
      connect: jest.fn(async () => null),
      getPublicKey: jest.fn(async () => ` ${STELLAR_KEY} `),
    };
    const session = await createFreighterAdapter({ provider }).connect();
    expect(session.account.address).toBe(STELLAR_KEY);
  });

  it('reports a missing extension with a retryable error', async () => {
    await expect(createFreighterAdapter({ provider: null }).connect()).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
  });

  it('maps a user rejection', async () => {
    const provider: FreighterProvider = {
      connect: jest.fn(async () => {
        throw Object.assign(new Error('User rejected the request'), { code: 4001 });
      }),
    };
    await expect(createFreighterAdapter({ provider }).connect()).rejects.toMatchObject({
      code: 'USER_REJECTED',
    });
  });

  it('rejects an invalid Stellar public key', async () => {
    const provider: FreighterProvider = { connect: jest.fn(async () => '0x123') };
    await expect(createFreighterAdapter({ provider }).connect()).rejects.toBeInstanceOf(
      WalletConnectionError
    );
    await expect(createFreighterAdapter({ provider }).connect()).rejects.toMatchObject({
      code: 'INVALID_ADDRESS',
    });
  });

  it('restores only a still-connected Freighter session', async () => {
    const session = {
      kind: 'freighter' as const,
      account: { address: STELLAR_KEY, network: 'stellar' as const },
      connectedAt: 1,
    };
    const provider: FreighterProvider = { isConnected: jest.fn(async () => false) };
    const adapter = createFreighterAdapter({ provider });

    expect(await adapter.restore(session)).toBeNull();
    expect(
      await createFreighterAdapter({
        provider: { isConnected: jest.fn(async () => true) },
      }).restore(session)
    ).toEqual(session);
    expect(await adapter.restore({ ...session, kind: 'walletconnect-v2' })).toBeNull();
  });

  it('disconnects through the provider when available', async () => {
    const provider: FreighterProvider = { disconnect: jest.fn(async () => undefined) };
    const adapter = createFreighterAdapter({ provider });
    await adapter.disconnect();
    expect(provider.disconnect).toHaveBeenCalledTimes(1);
  });
});
