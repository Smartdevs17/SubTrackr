import { buildPairingUri } from '../sessionManager';
import { getWalletConnectChain, WALLETCONNECT_CHAINS } from '../chains';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
}));

describe('walletconnect chains', () => {
  it('includes multiple supported chains', () => {
    expect(WALLETCONNECT_CHAINS.map((chain) => chain.chainId)).toEqual(
      expect.arrayContaining([1, 137, 42161, 10, 8453])
    );
  });

  it('resolves configured chain metadata', () => {
    const base = getWalletConnectChain(8453);

    expect(base?.name).toBe('Base');
    expect(base?.caipNetworkId).toBe('eip155:8453');
  });

  it('builds a v2 handoff pairing URI', () => {
    const uri = buildPairingUri('0xabc', 137);

    expect(uri).toContain('subtrackr://walletconnect');
    expect(uri).toContain(encodeURIComponent('"version":2'));
    expect(uri).toContain(encodeURIComponent('"chainId":137'));
  });
});
