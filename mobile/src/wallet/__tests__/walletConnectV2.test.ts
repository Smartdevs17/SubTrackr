import {
  DEFAULT_WALLETCONNECT_CHAINS,
  WALLETCONNECT_METHODS,
  buildPairingUri,
  createWalletConnectV2Adapter,
  isValidPairingUri,
} from '../walletConnectV2';
import type { WalletConnectConnector } from '../walletConnectV2';
import type { WalletSession } from '../types';

const TOPIC = 'a'.repeat(64);
const SYM_KEY = 'b'.repeat(64);
const EVM_ADDRESS = `0x${'1'.repeat(40)}`;
const STELLAR_KEY = `G${'A'.repeat(55)}`;

function makeConnector(overrides: Partial<WalletConnectConnector> = {}): WalletConnectConnector {
  return {
    connect: jest.fn(async () => ({
      accounts: [EVM_ADDRESS],
      chainId: 1,
      topic: TOPIC,
    })),
    disconnect: jest.fn(async () => undefined),
    ...overrides,
  };
}

const session: WalletSession = {
  kind: 'walletconnect-v2',
  account: { address: EVM_ADDRESS, network: 'evm', chainId: 1 },
  connectedAt: 1,
  pairingTopic: TOPIC,
};

describe('pairing URI', () => {
  it('builds and validates a WalletConnect v2 pairing URI', () => {
    const uri = buildPairingUri({ topic: TOPIC, symKey: SYM_KEY, chains: ['eip155:1'] });
    expect(uri).toContain(`wc:${TOPIC}@2?`);
    expect(uri).toContain('relay-protocol=irn');
    expect(uri).toContain(`symKey=${SYM_KEY}`);
    expect(uri).toContain('chains=eip155%3A1');
    expect(isValidPairingUri(uri)).toBe(true);
  });

  it('rejects malformed pairing inputs', () => {
    expect(isValidPairingUri('not-a-uri')).toBe(false);
    expect(() => buildPairingUri({ topic: 'short', symKey: SYM_KEY })).toThrow(/32 bytes/);
    expect(() => buildPairingUri({ topic: TOPIC, symKey: 'xyz' })).toThrow(/symKey/);
  });
});

describe('createWalletConnectV2Adapter', () => {
  it('connects an EVM account with default chains and methods', async () => {
    const connector = makeConnector();
    const adapter = createWalletConnectV2Adapter({ connector, now: () => 42 });

    const connected = await adapter.connect();

    expect(connector.connect).toHaveBeenCalledWith({
      chains: DEFAULT_WALLETCONNECT_CHAINS,
      methods: WALLETCONNECT_METHODS,
    });
    expect(connected).toEqual({
      kind: 'walletconnect-v2',
      account: { address: EVM_ADDRESS, network: 'evm', chainId: 1 },
      connectedAt: 42,
      pairingTopic: TOPIC,
    });
  });

  it('connects a Stellar account from a custom chain list', async () => {
    const connector = makeConnector({
      connect: jest.fn(async () => ({ accounts: [STELLAR_KEY], chainId: 'pubnet' })),
    });
    const adapter = createWalletConnectV2Adapter({ connector });

    const connected = await adapter.connect({ chains: ['stellar:pubnet'] });

    expect(connected.account).toEqual({
      address: STELLAR_KEY,
      network: 'stellar',
      chainId: 'pubnet',
      publicKey: STELLAR_KEY,
    });
    expect(connector.connect).toHaveBeenCalledWith(
      expect.objectContaining({ chains: ['stellar:pubnet'] })
    );
  });

  it('rejects an unsupported account', async () => {
    const connector = makeConnector({
      connect: jest.fn(async () => ({ accounts: ['not-an-address'], chainId: 1 })),
    });
    await expect(createWalletConnectV2Adapter({ connector }).connect()).rejects.toMatchObject({
      code: 'INVALID_ADDRESS',
    });
  });

  it('maps a user rejection from the connector', async () => {
    const connector = makeConnector({
      connect: jest.fn(async () => {
        throw new Error('User rejected the request');
      }),
    });
    await expect(createWalletConnectV2Adapter({ connector }).connect()).rejects.toMatchObject({
      code: 'USER_REJECTED',
    });
  });

  it('restores only an active session with a matching account', async () => {
    const active = createWalletConnectV2Adapter({
      connector: makeConnector({
        getSession: jest.fn(async () => ({ accounts: [EVM_ADDRESS], chainId: 1 })),
      }),
    });
    expect(await active.restore(session)).toEqual(session);

    const missing = createWalletConnectV2Adapter({
      connector: makeConnector({ getSession: jest.fn(async () => null) }),
    });
    expect(await missing.restore(session)).toBeNull();

    const different = createWalletConnectV2Adapter({
      connector: makeConnector({
        getSession: jest.fn(async () => ({ accounts: ['0x2'], chainId: 1 })),
      }),
    });
    expect(await different.restore(session)).toBeNull();
  });

  it('disconnects with a reason and notifies listeners', async () => {
    const connector = makeConnector();
    const onSessionChange = jest.fn();
    const adapter = createWalletConnectV2Adapter({
      connector,
      topic: TOPIC,
      onSessionChange,
    });

    await adapter.disconnect();

    expect(connector.disconnect).toHaveBeenCalledWith({
      topic: TOPIC,
      reason: 'user_disconnected',
    });
    expect(onSessionChange).toHaveBeenCalledWith(null);
  });
});
