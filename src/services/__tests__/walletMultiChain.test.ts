import { WalletServiceManager, type MultiChainBalances } from '../walletService';

const manager = WalletServiceManager.getInstance();

const balance = (symbol: string, amount: string) => ({
  symbol,
  name: symbol,
  address: `0x${symbol}`,
  balance: amount,
  decimals: 6,
});

describe('getBalancesAcrossChains', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('collects balances from every requested chain', async () => {
    jest
      .spyOn(manager, 'getTokenBalances')
      .mockImplementation(async (_address, chainId) =>
        chainId === 137 ? [balance('USDC', '50')] : [balance('USDC', '25')]
      );

    const result = await manager.getBalancesAcrossChains('0xpayer', [137, 42161]);
    expect(result.address).toBe('0xpayer');
    expect(result.results.map((r) => r.chainId)).toEqual([137, 42161]);
    expect(result.failedChainIds).toEqual([]);
  });

  it('reports a failing chain without losing the others', async () => {
    jest.spyOn(manager, 'getTokenBalances').mockImplementation(async (_address, chainId) => {
      if (chainId === 42161) throw new Error('RPC unreachable');
      return [balance('USDC', '50')];
    });

    const result = await manager.getBalancesAcrossChains('0xpayer', [137, 42161]);
    expect(result.failedChainIds).toEqual([42161]);

    const failed = result.results.find((r) => r.chainId === 42161)!;
    expect(failed.error).toBe('RPC unreachable');
    expect(failed.balances).toEqual([]);

    // The healthy chain still returned its data.
    expect(result.results.find((r) => r.chainId === 137)?.balances).toHaveLength(1);
  });

  it('queries the chains in parallel', async () => {
    let inFlight = 0;
    let peak = 0;
    jest.spyOn(manager, 'getTokenBalances').mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return [balance('USDC', '1')];
    });

    await manager.getBalancesAcrossChains('0xpayer', [1, 137, 42161]);
    expect(peak).toBe(3);
  });

  it('returns an empty result for an empty chain list', async () => {
    const result = await manager.getBalancesAcrossChains('0xpayer', []);
    expect(result.results).toEqual([]);
    expect(result.failedChainIds).toEqual([]);
  });
});

describe('totalsBySymbol', () => {
  const balances: MultiChainBalances = {
    address: '0xpayer',
    results: [
      { chainId: 137, balances: [balance('USDC', '50'), balance('MATIC', '3')] },
      { chainId: 42161, balances: [balance('USDC', '25')] },
      { chainId: 1, balances: [], error: 'down' },
    ],
    failedChainIds: [1],
  };

  it('keeps holdings separated by chain rather than summing them', () => {
    // The same symbol on two chains is not fungible, so it must not collapse
    // into one figure.
    expect(WalletServiceManager.totalsBySymbol(balances, 'USDC')).toEqual({
      137: 50,
      42161: 25,
    });
  });

  it('matches the symbol case-insensitively', () => {
    expect(WalletServiceManager.totalsBySymbol(balances, 'usdc')).toEqual({
      137: 50,
      42161: 25,
    });
  });

  it('omits chains that do not hold the token', () => {
    expect(WalletServiceManager.totalsBySymbol(balances, 'MATIC')).toEqual({ 137: 3 });
  });

  it('returns nothing for an unheld token', () => {
    expect(WalletServiceManager.totalsBySymbol(balances, 'DAI')).toEqual({});
  });

  it('reads an unparseable balance as zero rather than NaN', () => {
    const broken: MultiChainBalances = {
      address: '0xpayer',
      results: [{ chainId: 137, balances: [balance('USDC', 'not-a-number')] }],
      failedChainIds: [],
    };
    expect(WalletServiceManager.totalsBySymbol(broken, 'USDC')).toEqual({ 137: 0 });
  });
});
