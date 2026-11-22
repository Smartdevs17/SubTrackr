import { selectWalletProvider, WalletProviderState } from '../selectors';

const noop = async () => {};
const base: WalletProviderState = {
  connection: null,
  isLoading: false,
  error: null,
  connectWallet: noop,
  disconnect: noop,
  updateBalance: noop,
};

describe('selectWalletProvider', () => {
  it('reports a disconnected wallet', () => {
    expect(selectWalletProvider(base)).toMatchObject({ isConnected: false, address: null });
  });

  it('reports the connected address', () => {
    const conn = { address: 'GABC' } as WalletProviderState['connection'];
    expect(selectWalletProvider({ ...base, connection: conn })).toMatchObject({
      isConnected: true,
      address: 'GABC',
    });
  });

  it('maps store actions to provider names', () => {
    const p = selectWalletProvider(base);
    expect(p.connect).toBe(base.connectWallet);
    expect(p.refreshBalance).toBe(base.updateBalance);
  });
});
