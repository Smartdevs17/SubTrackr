import {
  EvmWalletChainStrategy,
  StellarWalletChainStrategy,
  NetworkError,
  NetworkErrorCode,
  type WalletChainStrategy,
  WalletChainStrategyRegistry,
  WalletServiceManager,
  WalletError,
  WalletErrorCode,
} from '../walletService';
import { ChainType } from '../../types/wallet';

describe('wallet chain strategies', () => {
  afterEach(() => {
    delete (globalThis as { freighterApi?: unknown }).freighterApi;
  });

  it('registers and resolves strategies by chain id', () => {
    const registry = new WalletChainStrategyRegistry([
      new EvmWalletChainStrategy(),
      new StellarWalletChainStrategy(),
    ]);

    expect(registry.getStrategyForChain(1).chainType).toBe(ChainType.EVM);
    expect(registry.getStrategyForChain(0x8000).chainType).toBe(ChainType.STELLAR);
    expect(registry.getSupportedChains().map((chain) => chain.chainId)).toEqual(
      expect.arrayContaining([1, 137, 42161, 0x8000])
    );
  });

  it('throws a network error for unsupported chains', () => {
    const registry = new WalletChainStrategyRegistry([new StellarWalletChainStrategy()]);

    expect(() => registry.getStrategyForChain(999999)).toThrow(NetworkError);
    expect(() => registry.getStrategyForChain(999999)).toThrow('Unsupported chain 999999.');
  });

  it('throws when resolving an unregistered strategy type', () => {
    const registry = new WalletChainStrategyRegistry();

    expect(() => registry.getStrategy(ChainType.EVM)).toThrow(
      'No wallet chain strategy registered for evm'
    );
  });

  it('reports native Stellar balances without RPC dependency', async () => {
    const strategy = new StellarWalletChainStrategy();

    const balances = await strategy.getTokenBalances(
      'GA7QYNF72M7XYTBMM2OZCYGF2H3O5SSJ3LZZ63G57277M2OZCYGF2H3O',
      0x8000,
      {
        getConnection: () => null,
        setConnection: jest.fn(),
        getWalletSigner: jest.fn(),
      }
    );

    expect(balances).toEqual([
      {
        symbol: 'XLM',
        name: 'Stellar Lumens',
        address: 'GA7QYNF72M7XYTBMM2OZCYGF2H3O5SSJ3LZZ63G57277M2OZCYGF2H3O',
        balance: '0',
        decimals: 7,
      },
    ]);
  });

  it('rejects unsupported Stellar chain ids', async () => {
    const strategy = new StellarWalletChainStrategy();

    await expect(
      strategy.getTokenBalances('GDUMMY', 1, {
        getConnection: () => null,
        setConnection: jest.fn(),
        getWalletSigner: jest.fn(),
      })
    ).rejects.toMatchObject({
      code: NetworkErrorCode.UNSUPPORTED_CHAIN,
    } satisfies Partial<NetworkError>);
  });

  it('returns deterministic Stellar fee estimates', async () => {
    const estimate = await new StellarWalletChainStrategy().estimateGas(
      { from: 'GA', to: 'GB', value: '1', chainId: 0x8000 },
      {
        getConnection: () => null,
        setConnection: jest.fn(),
        getWalletSigner: jest.fn(),
      }
    );

    expect(estimate).toEqual({
      gasLimit: '100',
      gasPrice: '0.00001',
      estimatedCost: '0.001',
    });
  });

  it('switches EVM chains through the connected EIP-1193 provider', async () => {
    const request = jest.fn().mockResolvedValue(undefined);
    const manager = new WalletServiceManager();
    manager.setConnection({
      address: '0x1234567890abcdef1234567890abcdef12345678',
      chainId: 1,
      chainType: ChainType.EVM,
      isConnected: true,
      eip1193Provider: { request },
    });

    const next = await manager.switchChain(ChainType.EVM, 137);

    expect(request).toHaveBeenCalledWith({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x89' }],
    });
    expect(next.chainId).toBe(137);
    expect(manager.getConnection()?.chainType).toBe(ChainType.EVM);
  });

  it('updates an existing Stellar connection when switching Stellar networks', async () => {
    const manager = new WalletServiceManager();
    manager.setConnection({
      address: 'GA7QYNF72M7XYTBMM2OZCYGF2H3O5SSJ3LZZ63G57277M2OZCYGF2H3O',
      chainId: 0x8000,
      chainType: ChainType.STELLAR,
      isConnected: true,
      stellarPublicKey: 'GA7QYNF72M7XYTBMM2OZCYGF2H3O5SSJ3LZZ63G57277M2OZCYGF2H3O',
    });

    const next = await manager.switchChain(ChainType.STELLAR, 0x8001);

    expect(next.chainId).toBe(0x8001);
    expect(next.chainType).toBe(ChainType.STELLAR);
    expect(manager.getConnection()?.chainId).toBe(0x8001);
  });

  it('connects during Stellar switching when no public key exists yet', async () => {
    (globalThis as { freighterApi?: unknown }).freighterApi = {
      getPublicKey: jest
        .fn()
        .mockResolvedValue('GA7QYNF72M7XYTBMM2OZCYGF2H3O5SSJ3LZZ63G57277M2OZCYGF2H3O'),
    };
    const manager = new WalletServiceManager();

    const connection = await manager.switchChain(ChainType.STELLAR, 0x8000);

    expect(connection.address).toMatch(/^G/);
    expect(connection.chainType).toBe(ChainType.STELLAR);
  });

  it('connects Stellar through a compatible global wallet provider', async () => {
    (globalThis as { freighterApi?: unknown }).freighterApi = {
      getPublicKey: jest
        .fn()
        .mockResolvedValue('GA7QYNF72M7XYTBMM2OZCYGF2H3O5SSJ3LZZ63G57277M2OZCYGF2H3O'),
    };
    const manager = new WalletServiceManager();

    const connection = await manager.connectStellarWallet();

    expect(connection.chainType).toBe(ChainType.STELLAR);
    expect(connection.chainId).toBe(0x8000);
    expect(connection.address).toMatch(/^G/);
  });

  it('raises a wallet error when switching EVM chains without an EVM provider', async () => {
    const manager = new WalletServiceManager();

    await expect(manager.switchChain(ChainType.EVM, 1)).rejects.toMatchObject({
      code: WalletErrorCode.NOT_CONNECTED,
      userMessage: 'EVM wallet is not connected.',
    } satisfies Partial<WalletError>);
  });

  it('raises a wallet error when connecting Stellar without a provider', async () => {
    const manager = new WalletServiceManager();

    await expect(manager.connectStellarWallet()).rejects.toMatchObject({
      code: WalletErrorCode.NOT_CONNECTED,
      userMessage: 'Stellar wallet is not connected.',
    } satisfies Partial<WalletError>);
  });

  it('delegates manager balance reads to the registered strategy', async () => {
    const getTokenBalances = jest.fn(async () => [
      {
        symbol: 'TEST',
        name: 'Test Token',
        address: '0xtest',
        balance: '1',
        decimals: 18,
      },
    ]);
    const strategy: WalletChainStrategy = {
      chainType: ChainType.EVM,
      supportsChain: (chainId) => chainId === 777,
      getSupportedChains: () => [
        {
          chainType: ChainType.EVM,
          chainId: 777,
          name: 'Testnet',
          nativeSymbol: 'TEST',
        },
      ],
      getTokenBalances,
    };
    const manager = new WalletServiceManager(new WalletChainStrategyRegistry([strategy]));

    await expect(manager.getTokenBalances('0xwallet', 777)).resolves.toHaveLength(1);
    expect(getTokenBalances).toHaveBeenCalledWith('0xwallet', 777, manager);
    expect(manager.getSupportedChains()).toEqual([
      {
        chainType: ChainType.EVM,
        chainId: 777,
        name: 'Testnet',
        nativeSymbol: 'TEST',
      },
    ]);
  });

  it('rejects manager gas estimation when the strategy has no estimator', async () => {
    const strategy: WalletChainStrategy = {
      chainType: ChainType.EVM,
      supportsChain: (chainId) => chainId === 777,
      getSupportedChains: () => [],
      getTokenBalances: jest.fn(async () => []),
    };
    const manager = new WalletServiceManager(new WalletChainStrategyRegistry([strategy]));

    await expect(manager.estimateGas('0xfrom', '0xto', '0', 777)).rejects.toMatchObject({
      code: NetworkErrorCode.UNSUPPORTED_CHAIN,
    } satisfies Partial<NetworkError>);
  });

  it('rejects manager chain switching when the strategy cannot switch', async () => {
    const strategy: WalletChainStrategy = {
      chainType: ChainType.EVM,
      supportsChain: (chainId) => chainId === 777,
      getSupportedChains: () => [],
      getTokenBalances: jest.fn(async () => []),
    };
    const manager = new WalletServiceManager(new WalletChainStrategyRegistry([strategy]));

    await expect(manager.switchChain(ChainType.EVM, 777)).rejects.toMatchObject({
      code: NetworkErrorCode.UNSUPPORTED_CHAIN,
    } satisfies Partial<NetworkError>);
  });

  it('rejects Stellar connections when the registered strategy cannot connect', async () => {
    const strategy: WalletChainStrategy = {
      chainType: ChainType.STELLAR,
      supportsChain: (chainId) => chainId === 0x8000,
      getSupportedChains: () => [],
      getTokenBalances: jest.fn(async () => []),
    };
    const manager = new WalletServiceManager(new WalletChainStrategyRegistry([strategy]));

    await expect(manager.connectStellarWallet()).rejects.toMatchObject({
      code: WalletErrorCode.NOT_CONNECTED,
      userMessage: 'Stellar wallet support is not available.',
    } satisfies Partial<WalletError>);
  });
});
