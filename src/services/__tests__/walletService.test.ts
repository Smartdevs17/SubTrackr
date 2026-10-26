import {
  WalletServiceManager,
  WalletConnection,
  TokenBalance,
  GasEstimate,
  WalletError,
  WalletErrorCode,
  errorTracker,
  NetworkError,
  NetworkErrorCode,
  ContractError,
  ContractErrorCode,
} from '../walletService';
import { ethers } from 'ethers';
import { Framework } from '@superfluid-finance/sdk-core';
import { getContractAddress, ERC20__factory } from '../../contracts';

// ── Mock dependencies ──────────────────────────────────────────────

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers') as Record<string, unknown>;
  return {
    ...actual,
    providers: {
      JsonRpcProvider: jest.fn().mockImplementation(() => ({
        getBalance: jest.fn(),
        getGasPrice: jest.fn(),
      })),
      Web3Provider: jest.fn().mockImplementation(() => ({
        getSigner: jest.fn(),
      })),
    },
  };
});

jest.mock('@superfluid-finance/sdk-core', () => ({
  Framework: {
    create: jest.fn(),
  },
  SFError: class extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'SFError';
    }
  },
}));

jest.mock('../../contracts', () => ({
  ERC20__factory: {
    connect: jest.fn(),
  },
  getContractAddress: jest.fn(),
}));

jest.mock('../../config/evm', () => ({
  getEvmRpcUrl: jest.fn().mockReturnValue('https://rpc.example.com'),
  getChainType: jest.fn().mockReturnValue('evm'),
  getDefaultStellarNetwork: jest.fn().mockReturnValue({
    name: 'Stellar Testnet',
    networkPassphrase: 'Test SDF Network ; September 2015',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    nativeAsset: 'XLM',
  }),
  STELLAR_NETWORKS: {},
  EVM_RPC_URLS: { 1: 'https://rpc.example.com' },
}));

const mockedGetContractAddress = getContractAddress as jest.MockedFunction<
  typeof getContractAddress
>;
const mockedFrameworkCreate = Framework.create as jest.MockedFunction<typeof Framework.create>;

// ── Helpers ────────────────────────────────────────────────────────

const senderAddress = '0x0000000000000000000000000000000000000001';
const recipientAddress = '0x0000000000000000000000000000000000000002';
const tokenAddress = '0x0000000000000000000000000000000000000003';

function createMockConnection(overrides?: Partial<WalletConnection>): WalletConnection {
  return {
    address: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
    chainId: 1,
    isConnected: true,
    eip1193Provider: {} as ethers.providers.ExternalProvider,
    ...overrides,
  };
}

function freshManager(): WalletServiceManager {
  // Reset singleton state by re-instantiating via reflection
  const mgr = new WalletServiceManager() as any;
  mgr.connection = null;
  mgr.listeners = [];
  return mgr;
}

function mockSuperfluidSdk(
  options: {
    gasLimit?: ethers.BigNumberish;
    transactionHash?: string | null;
    decimals?: number;
  } = {}
) {
  const getPopulatedTransactionRequest = jest.fn().mockResolvedValue({
    gasLimit:
      options.gasLimit === undefined
        ? ethers.BigNumber.from('100000')
        : options.gasLimit === null
          ? null
          : ethers.BigNumber.from(options.gasLimit),
  });
  const exec = jest.fn().mockResolvedValue({
    wait: jest
      .fn()
      .mockResolvedValue(
        options.transactionHash === null
          ? {}
          : { transactionHash: options.transactionHash ?? '0xsuperfluid' }
      ),
  });
  const createFlow = jest.fn().mockReturnValue({ getPopulatedTransactionRequest, exec });
  const loadSuperToken = jest.fn().mockResolvedValue({
    address: tokenAddress,
    contract: {
      decimals: jest.fn().mockResolvedValue(options.decimals ?? 18),
    },
  });

  mockedFrameworkCreate.mockResolvedValue({
    loadSuperToken,
    cfaV1: {
      createFlow,
    },
  } as unknown as Awaited<ReturnType<typeof Framework.create>>);

  return { createFlow, exec, getPopulatedTransactionRequest, loadSuperToken };
}

function createMockSigner(chainId = 1) {
  return {
    provider: {
      getNetwork: jest.fn().mockResolvedValue({ chainId }),
      getGasPrice: jest.fn().mockResolvedValue(ethers.BigNumber.from('20000000000')),
    },
    getAddress: jest.fn().mockResolvedValue(senderAddress),
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe('WalletServiceManager', () => {
  describe('Singleton', () => {
    it('getInstance returns the same instance', () => {
      const a = WalletServiceManager.getInstance();
      const b = WalletServiceManager.getInstance();
      expect(a).toBe(b);
    });
  });

  describe('Connection management', () => {
    let mgr: WalletServiceManager;

    beforeEach(() => {
      mgr = freshManager() as typeof mgr;
    });

    it('getConnection returns null by default', () => {
      expect(mgr.getConnection()).toBeNull();
    });

    it('setConnection updates and notifies listeners', () => {
      const listener = jest.fn();
      const conn = createMockConnection();
      mgr.addListener(listener);
      mgr.setConnection(conn);

      expect(mgr.getConnection()).toBe(conn);
      expect(listener).toHaveBeenCalledWith(conn);
    });

    it('removeListener stops notification', () => {
      const listener = jest.fn();
      mgr.addListener(listener);
      mgr.removeListener(listener);
      mgr.setConnection(createMockConnection());
      expect(listener).not.toHaveBeenCalled();
    });

    it('isConnected returns false when no connection', () => {
      expect(mgr.isConnected()).toBe(false);
    });

    it('isConnected returns true when connected', () => {
      mgr.setConnection(createMockConnection());
      expect(mgr.isConnected()).toBe(true);
    });
  });

  describe('disconnectWallet', () => {
    it('clears connection and notifies listeners', async () => {
      const mgr = freshManager();
      const listener = jest.fn();
      mgr.addListener(listener);
      mgr.setConnection(createMockConnection());

      await mgr.disconnectWallet();

      expect(mgr.getConnection()).toBeNull();
      expect(listener).toHaveBeenCalledWith(null);
    });
  });

  describe('initialize', () => {
    it('resolves without error', async () => {
      const mgr = freshManager();
      await expect(mgr.initialize()).resolves.toBeUndefined();
    });
  });

  describe('getTokenBalances', () => {
    let mgr: WalletServiceManager;
    let mockProvider: { getBalance: jest.Mock; getGasPrice: jest.Mock };

    beforeEach(() => {
      mgr = freshManager() as typeof mgr;
      mockProvider = {
        getBalance: jest.fn().mockResolvedValue(ethers.BigNumber.from('1000000000000000000')),
        getGasPrice: jest.fn(),
      };
      jest
        .spyOn(ethers.providers, 'JsonRpcProvider')
        .mockImplementation(() => mockProvider as unknown as ethers.providers.JsonRpcProvider);
    });

    it('returns native balance for chainId 1', async () => {
      const balances = await mgr.getTokenBalances('0xAddr', 1);
      expect(balances.length).toBeGreaterThanOrEqual(1);
      expect(balances[0].symbol).toBe('ETH');
      expect(balances[0].balance).toBe('1.0');
    });

    it('returns MATIC native balance for chainId 137', async () => {
      const balances = await mgr.getTokenBalances('0xAddr', 137);
      expect(balances[0].symbol).toBe('MATIC');
    });

    it('returns ETH for chainId 42161 (Arbitrum)', async () => {
      const balances = await mgr.getTokenBalances('0xAddr', 42161);
      expect(balances[0].symbol).toBe('ETH');
    });

    it('returns ETH as default for unknown chainId', async () => {
      const balances = await mgr.getTokenBalances('0xAddr', 999);
      expect(balances[0].symbol).toBe('ETH');
    });

    it('includes USDC for supported chains when contract address exists', async () => {
      mockedGetContractAddress.mockReturnValue('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');

      const mockBalanceOf = jest.fn().mockResolvedValue(ethers.BigNumber.from('5000000'));
      const mockContract = { balanceOf: mockBalanceOf, decimals: jest.fn() };
      (ERC20__factory.connect as jest.Mock).mockReturnValue(mockContract);

      const balances = await mgr.getTokenBalances('0xAddr', 1);
      const usdc = balances.find((b: TokenBalance) => b.symbol === 'USDC');
      expect(usdc).toBeDefined();
      expect(usdc!.balance).toBe('5.0');
    });

    it('skips USDC when contract address is null', async () => {
      mockedGetContractAddress.mockReturnValue(undefined);
      const balances = await mgr.getTokenBalances('0xAddr', 1);
      const usdc = balances.find((b: TokenBalance) => b.symbol === 'USDC');
      expect(usdc).toBeUndefined();
    });

    it('handles USDC contract errors gracefully', async () => {
      mockedGetContractAddress.mockReturnValue('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');

      const mockContract = {
        balanceOf: jest.fn().mockRejectedValue(new Error('call revert')),
        decimals: jest.fn(),
      };
      (ERC20__factory.connect as jest.Mock).mockReturnValue(mockContract);

      const balances = await mgr.getTokenBalances('0xAddr', 1);
      const usdc = balances.find((b: TokenBalance) => b.symbol === 'USDC');
      expect(usdc).toBeUndefined();
    });

    it('throws when provider fails for native balance', async () => {
      mockProvider.getBalance.mockRejectedValue(new Error('RPC down'));
      await expect(mgr.getTokenBalances('0xAddr', 1)).rejects.toThrow('RPC down');
    });
  });

  describe('estimateGas', () => {
    let mgr: WalletServiceManager;
    let mockProvider: { getBalance: jest.Mock; getGasPrice: jest.Mock; estimateGas: jest.Mock };

    beforeEach(() => {
      mgr = freshManager() as typeof mgr;
      mockProvider = {
        getBalance: jest.fn(),
        getGasPrice: jest.fn().mockResolvedValue(ethers.BigNumber.from('20000000000')), // 20 gwei
        estimateGas: jest.fn().mockResolvedValue(ethers.BigNumber.from('17500')),
      };
      jest
        .spyOn(ethers.providers, 'JsonRpcProvider')
        .mockImplementation(() => mockProvider as unknown as ethers.providers.JsonRpcProvider);
    });

    it('returns a valid gas estimate', async () => {
      const estimate: GasEstimate = await mgr.estimateGas('0xFrom', '0xTo', '1.0', 1);
      expect(estimate.gasLimit).toBe('21000');
      expect(estimate.gasPrice).toBe('20.0');
      expect(parseFloat(estimate.estimatedCost)).toBeGreaterThan(0);
    });

    it('throws when provider fails', async () => {
      mockProvider.getGasPrice.mockRejectedValue(new Error('network error'));
      await expect(mgr.estimateGas('0xFrom', '0xTo', '1.0', 1)).rejects.toThrow('network error');
    });
  });

  describe('getWalletSigner (private)', () => {
    it('throws WalletError with NOT_CONNECTED code when no connection', () => {
      const mgr = freshManager();
      try {
        (mgr as any).getWalletSigner();
        fail('expected to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(WalletError);
        expect((e as WalletError).code).toBe(WalletErrorCode.NOT_CONNECTED);
        expect((e as WalletError).userMessage).toBe('EVM wallet is not connected.');
        expect((e as WalletError).recovery).toBeDefined();
      }
    });

    it('throws WalletError when connection has no eip1193Provider', () => {
      const mgr = freshManager();
      mgr.setConnection(createMockConnection({ eip1193Provider: undefined }));
      try {
        (mgr as any).getWalletSigner();
        fail('expected to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(WalletError);
        expect((e as WalletError).code).toBe(WalletErrorCode.NOT_CONNECTED);
      }
    });
  });

  describe('createSuperfluidStream – user rejection', () => {
    it('throws WalletError USER_REJECTED when user rejects transaction', async () => {
      const mgr = freshManager();
      const mockSigner = {
        provider: { getNetwork: jest.fn().mockResolvedValue({ chainId: 1 }) },
        getAddress: jest.fn().mockResolvedValue('0xSender'),
      };
      jest.spyOn(mgr as any, 'getWalletSigner').mockReturnValue(mockSigner);
      jest.spyOn(mgr as any, 'buildSuperfluidCreateFlowContext').mockRejectedValue({
        code: 4001,
        message: 'User rejected',
      });

      try {
        await mgr.createSuperfluidStream('ETH', '10', '0xRecipient', 1);
        fail('expected to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(WalletError);
        expect((e as WalletError).code).toBe(WalletErrorCode.USER_REJECTED);
        expect((e as WalletError).recovery).toBeDefined();
      }
    });
  });

  describe('createSuperfluidStream – user denied (string code)', () => {
    it('throws WalletError USER_REJECTED for ACTION_REJECTED code', async () => {
      const mgr = freshManager();
      const mockSigner = {
        provider: { getNetwork: jest.fn().mockResolvedValue({ chainId: 1 }) },
        getAddress: jest.fn().mockResolvedValue('0xSender'),
      };
      jest.spyOn(mgr as any, 'getWalletSigner').mockReturnValue(mockSigner);
      jest.spyOn(mgr as any, 'buildSuperfluidCreateFlowContext').mockRejectedValue({
        code: 'ACTION_REJECTED',
      });

      try {
        await mgr.createSuperfluidStream('ETH', '10', '0xRecipient', 1);
        fail('expected to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(WalletError);
        expect((e as WalletError).code).toBe(WalletErrorCode.USER_REJECTED);
      }
    });
  });

  describe('estimateSuperfluidCreateFlow – network mismatch', () => {
    it('throws when wallet chainId differs from requested chainId', async () => {
      const mgr = freshManager();
      const mockSigner = {
        provider: { getNetwork: jest.fn().mockResolvedValue({ chainId: 137 }) },
      };
      jest.spyOn(mgr as any, 'getWalletSigner').mockReturnValue(mockSigner);

      await expect(mgr.estimateSuperfluidCreateFlow('ETH', '10', '0xRecipient', 1)).rejects.toThrow(
        'does not match selected chain'
      );
    });
  });

  describe('estimateSuperfluidCreateFlow', () => {
    it('returns a gas estimate from a populated Superfluid createFlow transaction', async () => {
      const mgr = freshManager();
      const mockSigner = createMockSigner(1);
      const superfluid = mockSuperfluidSdk({ gasLimit: '100000' });
      jest.spyOn(mgr as any, 'getWalletSigner').mockReturnValue(mockSigner);

      const estimate = await mgr.estimateSuperfluidCreateFlow('ETH', '10', recipientAddress, 1);

      expect(superfluid.loadSuperToken).toHaveBeenCalledWith('ETHx');
      expect(superfluid.createFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          sender: senderAddress,
          receiver: recipientAddress,
          flowRate: expect.any(String),
        })
      );
      expect(estimate).toEqual({
        gasLimit: '100000',
        gasPrice: '20.0',
        estimatedCost: '0.002',
      });
    });

    it('maps ETH to MATICx for Polygon Superfluid streams', async () => {
      const mgr = freshManager();
      const mockSigner = createMockSigner(137);
      const superfluid = mockSuperfluidSdk();
      jest.spyOn(mgr as any, 'getWalletSigner').mockReturnValue(mockSigner);

      await mgr.estimateSuperfluidCreateFlow('ETH', '10', recipientAddress, 137);

      expect(superfluid.loadSuperToken).toHaveBeenCalledWith('MATICx');
    });

    it('rejects unsupported Superfluid resolver symbols', async () => {
      const mgr = freshManager();
      const mockSigner = createMockSigner(42161);
      mockSuperfluidSdk();
      jest.spyOn(mgr as any, 'getWalletSigner').mockReturnValue(mockSigner);

      await expect(
        mgr.estimateSuperfluidCreateFlow('ARB', '10', recipientAddress, 42161)
      ).rejects.toThrow('ARB is not supported as a Superfluid super token');
    });

    it('rejects self-directed Superfluid streams', async () => {
      const mgr = freshManager();
      const mockSigner = createMockSigner(1);
      mockSuperfluidSdk();
      jest.spyOn(mgr as any, 'getWalletSigner').mockReturnValue(mockSigner);

      await expect(mgr.estimateSuperfluidCreateFlow('ETH', '10', senderAddress, 1)).rejects.toThrow(
        'Recipient must be a different address'
      );
    });
  });

  describe('createSuperfluidStream', () => {
    it('executes a Superfluid createFlow operation and returns a stream id', async () => {
      const mgr = freshManager();
      const mockSigner = createMockSigner(1);
      mockSuperfluidSdk({ transactionHash: '0xstreamtx' });
      jest.spyOn(mgr as any, 'getWalletSigner').mockReturnValue(mockSigner);

      const result = await mgr.createSuperfluidStream('USDC', '10', recipientAddress, 1);

      expect(result).toEqual({
        txHash: '0xstreamtx',
        streamId: `${tokenAddress}:${senderAddress}:${recipientAddress}`,
      });
    });

    it('wraps non-rejection Superfluid failures in a WalletError', async () => {
      const mgr = freshManager();
      const mockSigner = createMockSigner(1);
      const superfluid = mockSuperfluidSdk();
      superfluid.exec.mockResolvedValueOnce({
        wait: jest.fn().mockResolvedValue({}),
      });
      jest.spyOn(mgr as any, 'getWalletSigner').mockReturnValue(mockSigner);

      await expect(
        mgr.createSuperfluidStream('USDC', '10', recipientAddress, 1)
      ).rejects.toMatchObject({
        code: WalletErrorCode.STREAM_CREATION_FAILED,
        userMessage: 'Stream creation failed.',
      } satisfies Partial<WalletError>);
    });
  });

  describe('createSablierStream – user denied via message', () => {
    it('throws WalletError USER_REJECTED for user denied message', async () => {
      const mgr = freshManager();
      const mockSigner = {
        provider: { getNetwork: jest.fn().mockResolvedValue({ chainId: 1 }) },
        getAddress: jest.fn().mockResolvedValue('0xSender'),
      };
      jest.spyOn(mgr as any, 'getWalletSigner').mockReturnValue(mockSigner);

      jest.spyOn(ethers, 'Contract' as any).mockImplementation(() => {
        throw new Error('user denied transaction');
      });

      try {
        await mgr.createSablierStream(
          '0xToken',
          '10',
          Date.now(),
          Date.now() + 86400000,
          '0xRecipient',
          1
        );
        fail('expected to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(WalletError);
        expect((e as WalletError).code).toBe(WalletErrorCode.USER_REJECTED);
      }
    });
  });

  describe('createSablierStream', () => {
    it('approves tokens when needed and creates a Sablier stream', async () => {
      const mgr = freshManager();
      const mockSigner = createMockSigner(1);
      jest.spyOn(mgr as any, 'getWalletSigner').mockReturnValue(mockSigner);

      const approve = jest.fn().mockResolvedValue({ wait: jest.fn().mockResolvedValue({}) });
      const createWithDurations = jest.fn().mockResolvedValue({
        wait: jest.fn().mockResolvedValue({ transactionHash: '0xsablier' }),
      });
      const contractSpy = jest
        .spyOn(ethers, 'Contract' as any)
        .mockImplementationOnce(() => ({
          decimals: jest.fn().mockResolvedValue(6),
          allowance: jest.fn().mockResolvedValue(ethers.BigNumber.from(0)),
          approve,
        }))
        .mockImplementationOnce(() => ({ createWithDurations }));

      try {
        const txHash = await mgr.createSablierStream(
          tokenAddress,
          '10',
          Date.now(),
          Date.now() + 86_400_000,
          recipientAddress,
          1
        );

        expect(approve).toHaveBeenCalledTimes(1);
        expect(createWithDurations).toHaveBeenCalledWith(
          expect.objectContaining({
            sender: senderAddress,
            recipient: recipientAddress,
            asset: tokenAddress,
          })
        );
        expect(txHash).toBe('0xsablier');
      } finally {
        contractSpy.mockRestore();
      }
    });

    it('wraps non-rejection Sablier failures in a WalletError', async () => {
      const mgr = freshManager();
      const mockSigner = createMockSigner(1);
      jest.spyOn(mgr as any, 'getWalletSigner').mockReturnValue(mockSigner);

      const contractSpy = jest.spyOn(ethers, 'Contract' as any).mockImplementation(() => {
        throw new Error('contract unavailable');
      });

      try {
        await expect(
          mgr.createSablierStream(
            tokenAddress,
            '10',
            Date.now(),
            Date.now() + 86_400_000,
            recipientAddress,
            1
          )
        ).rejects.toMatchObject({
          code: WalletErrorCode.STREAM_CREATION_FAILED,
          userMessage: 'Stream creation failed.',
        } satisfies Partial<WalletError>);
      } finally {
        contractSpy.mockRestore();
      }
    });
  });

  describe('ERC20 allowance and approval helpers', () => {
    it('reads ERC20 allowance through the configured provider', async () => {
      const mgr = freshManager();
      const allowance = jest.fn().mockResolvedValue(ethers.BigNumber.from(42));
      const contractSpy = jest.spyOn(ethers, 'Contract' as any).mockImplementation(() => ({
        allowance,
      }));

      try {
        await expect(
          mgr.getErc20Allowance(tokenAddress, senderAddress, recipientAddress, 1)
        ).resolves.toEqual(ethers.BigNumber.from(42));
        expect(allowance).toHaveBeenCalledWith(senderAddress, recipientAddress);
      } finally {
        contractSpy.mockRestore();
      }
    });

    it('estimates approval gas using the connected wallet signer', async () => {
      const mgr = freshManager();
      mgr.setConnection(createMockConnection());
      const mockProvider = {
        getGasPrice: jest.fn().mockResolvedValue(ethers.BigNumber.from('20000000000')),
      };
      jest
        .spyOn(ethers.providers, 'JsonRpcProvider')
        .mockImplementation(() => mockProvider as unknown as ethers.providers.JsonRpcProvider);
      jest.spyOn(ethers.providers, 'Web3Provider').mockImplementation(
        () =>
          ({
            getSigner: jest.fn().mockReturnValue(createMockSigner(1)),
          }) as unknown as ethers.providers.Web3Provider
      );
      const contractSpy = jest.spyOn(ethers, 'Contract' as any).mockImplementation(() => ({
        estimateGas: {
          approve: jest.fn().mockResolvedValue(ethers.BigNumber.from('17500')),
        },
      }));

      try {
        const estimate = await mgr.estimateApproveGas(tokenAddress, recipientAddress, 100, 1);

        expect(estimate.gasLimit).toBe('21000');
        expect(estimate.gasPrice).toBe('20.0');
      } finally {
        contractSpy.mockRestore();
      }
    });

    it('uses the fallback gas limit when approval gas estimation fails', async () => {
      const mgr = freshManager();
      mgr.setConnection(createMockConnection());
      const mockProvider = {
        getGasPrice: jest.fn().mockResolvedValue(ethers.BigNumber.from('20000000000')),
      };
      jest
        .spyOn(ethers.providers, 'JsonRpcProvider')
        .mockImplementation(() => mockProvider as unknown as ethers.providers.JsonRpcProvider);
      jest.spyOn(ethers.providers, 'Web3Provider').mockImplementation(
        () =>
          ({
            getSigner: jest.fn().mockReturnValue(createMockSigner(1)),
          }) as unknown as ethers.providers.Web3Provider
      );
      const contractSpy = jest.spyOn(ethers, 'Contract' as any).mockImplementation(() => ({
        estimateGas: {
          approve: jest.fn().mockRejectedValue(new Error('cannot estimate')),
        },
      }));

      try {
        const estimate = await mgr.estimateApproveGas(tokenAddress, recipientAddress, 100, 1);

        expect(estimate.gasLimit).toBe('100000');
        expect(estimate.gasPrice).toBe('20.0');
      } finally {
        contractSpy.mockRestore();
      }
    });

    it('executes ERC20 approval and returns the transaction hash', async () => {
      const mgr = freshManager();
      jest.spyOn(mgr as any, 'getWalletSigner').mockReturnValue(createMockSigner(1));
      const contractSpy = jest.spyOn(ethers, 'Contract' as any).mockImplementation(() => ({
        approve: jest.fn().mockResolvedValue({
          wait: jest.fn().mockResolvedValue({ transactionHash: '0xapprove' }),
        }),
      }));

      try {
        await expect(mgr.approveErc20(tokenAddress, recipientAddress, 100)).resolves.toBe(
          '0xapprove'
        );
      } finally {
        contractSpy.mockRestore();
      }
    });

    it('reports ERC20 approval rejection as USER_REJECTED', async () => {
      const mgr = freshManager();
      jest.spyOn(mgr as any, 'getWalletSigner').mockReturnValue(createMockSigner(1));
      const contractSpy = jest.spyOn(ethers, 'Contract' as any).mockImplementation(() => ({
        approve: jest.fn().mockRejectedValue({ code: 4001, message: 'user rejected' }),
      }));

      try {
        await expect(mgr.approveErc20(tokenAddress, recipientAddress, 100)).rejects.toMatchObject({
          code: WalletErrorCode.USER_REJECTED,
          userMessage: 'Approval was rejected in your wallet.',
        } satisfies Partial<WalletError>);
      } finally {
        contractSpy.mockRestore();
      }
    });
  });

  describe('WalletError structure', () => {
    it('has code, userMessage, and recovery fields', () => {
      const err = new WalletError(
        WalletErrorCode.STREAM_CREATION_FAILED,
        'Stream creation failed.',
        'Check your token balance and try again.'
      );
      expect(err.code).toBe(WalletErrorCode.STREAM_CREATION_FAILED);
      expect(err.userMessage).toBe('Stream creation failed.');
      expect(err.recovery).toBe('Check your token balance and try again.');
      expect(err.name).toBe('WalletError');
    });

    it('preserves cause stack when cause is an Error', () => {
      const cause = new Error('rpc timeout');
      const err = new WalletError(
        WalletErrorCode.UNKNOWN,
        'Something went wrong.',
        undefined,
        cause
      );
      expect(err.stack).toContain('Caused by:');
    });
  });

  describe('errorTracker', () => {
    beforeEach(() => errorTracker.reset());

    it('records error counts by code', () => {
      errorTracker.record(WalletErrorCode.USER_REJECTED);
      errorTracker.record(WalletErrorCode.USER_REJECTED);
      errorTracker.record(WalletErrorCode.NOT_CONNECTED);
      const stats = errorTracker.getStats();
      expect(stats[WalletErrorCode.USER_REJECTED].count).toBe(2);
      expect(stats[WalletErrorCode.NOT_CONNECTED].count).toBe(1);
    });

    it('reset clears all counts', () => {
      errorTracker.record(WalletErrorCode.APPROVAL_FAILED);
      errorTracker.reset();
      expect(Object.keys(errorTracker.getStats()).length).toBe(0);
    });
  });

  describe('getTokenBalances – structured error', () => {
    it('throws NetworkError RPC_ERROR when provider fails', async () => {
      const mgr = freshManager();
      const mockProvider = {
        getBalance: jest.fn().mockRejectedValue(new Error('RPC down')),
        getGasPrice: jest.fn(),
      };
      jest
        .spyOn(ethers.providers, 'JsonRpcProvider')
        .mockImplementation(() => mockProvider as unknown as ethers.providers.JsonRpcProvider);

      try {
        await mgr.getTokenBalances('0xAddr', 1);
        fail('expected to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(NetworkError);
        expect((e as NetworkError).code).toBe(NetworkErrorCode.RPC_ERROR);
        expect((e as NetworkError).recovery).toBeDefined();
      }
    });
  });

  describe('approveErc20 – structured error', () => {
    it('throws ContractError EXECUTION_FAILED when approval transaction fails', async () => {
      const mgr = freshManager();
      const mockSigner = {
        provider: { getNetwork: jest.fn().mockResolvedValue({ chainId: 1 }) },
        getAddress: jest.fn().mockResolvedValue('0xSender'),
      };
      jest.spyOn(mgr as any, 'getWalletSigner').mockReturnValue(mockSigner);

      jest.spyOn(ethers, 'Contract' as any).mockImplementation(() => ({
        approve: jest.fn().mockRejectedValue(new Error('Transaction reverted')),
      }));

      try {
        await mgr.approveErc20('0xToken', '0xSpender', 100);
        fail('expected to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ContractError);
        expect((e as ContractError).code).toBe(ContractErrorCode.EXECUTION_FAILED);
        expect((e as ContractError).userMessage).toBe('Token approval failed.');
      }
    });
  });
});
