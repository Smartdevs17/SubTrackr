import { ChainType } from '../../types/wallet';
import { WalletError, WalletErrorCode, walletServiceManager } from '../walletService';
import { simulateStellarTransaction } from '../stellarTransactionService';
import { signViaDeepLink } from '../sep0007Service';
import { crossChainRoutingService, type CrossChainPaymentRoute } from '../crossChainRoutingService';

jest.mock('../walletService', () => {
  const actual = jest.requireActual('../walletService');
  return {
    ...actual,
    walletServiceManager: {
      getConnection: jest.fn(),
      getStellarProvider: jest.fn(),
      getWalletSigner: jest.fn(),
      getProvider: jest.fn(),
    },
  };
});

jest.mock('../stellarTransactionService', () => ({
  simulateStellarTransaction: jest.fn(),
}));

jest.mock('../sep0007Service', () => ({
  ...jest.requireActual('../sep0007Service'),
  signViaDeepLink: jest.fn(),
}));

const mockConnection = walletServiceManager.getConnection as jest.Mock;
const mockGetStellarProvider = walletServiceManager.getStellarProvider as jest.Mock;
const mockSimulate = simulateStellarTransaction as jest.Mock;
const mockSignViaDeepLink = signViaDeepLink as jest.Mock;

const VALID_PUBKEY = 'G'.padEnd(56, 'A');

const stellarRoute: CrossChainPaymentRoute = {
  sourceChainType: ChainType.STELLAR,
  sourceChainId: 0x8000,
  targetChainType: ChainType.STELLAR,
  targetChainId: 0x8000,
  tokenAddress: 'XLM',
  amount: '10',
  estimatedFee: '0.00001',
  estimatedTime: 'instant',
};

const successfulSimulation = {
  success: true,
  fees: {
    totalFeeXlm: '0.0001',
    totalFeeStroops: 100,
    inclusionFeeStroops: 100,
    inclusionFeeXlm: '0.00001',
    resourceFeeStroops: 0,
    resourceFeeXlm: '0',
  },
  storage: {
    readBytes: 0,
    writeBytes: 0,
    diskBytes: 0,
    memoryBytes: 0,
    instructions: 0,
    readOnlyEntries: 0,
    readWriteEntries: 0,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('executePayment', () => {
  it('throws NOT_CONNECTED when no wallet is connected', async () => {
    mockConnection.mockReturnValue(null);

    await expect(crossChainRoutingService.executePayment(stellarRoute)).rejects.toMatchObject({
      code: WalletErrorCode.NOT_CONNECTED,
    });
  });

  it('routes Stellar payments through the Stellar path', async () => {
    mockConnection.mockReturnValue({ stellarPublicKey: VALID_PUBKEY });
    mockGetStellarProvider.mockReturnValue({
      getPublicKey: jest.fn().mockResolvedValue(VALID_PUBKEY),
      signTransaction: jest.fn().mockResolvedValue('signed-xdr'),
      submitTransaction: jest.fn().mockResolvedValue({ hash: 'txhash123' }),
    });
    mockSimulate.mockResolvedValue(successfulSimulation);

    const hash = await crossChainRoutingService.executePayment(stellarRoute);
    expect(hash).toBe('txhash123');
  });
});

describe('executeStellarPayment with Freighter', () => {
  it('signs and submits through the injected provider', async () => {
    const signTransaction = jest.fn().mockResolvedValue('signed-xdr');
    const submitTransaction = jest.fn().mockResolvedValue({ hash: 'freighter-hash' });
    mockGetStellarProvider.mockReturnValue({
      getPublicKey: jest.fn().mockResolvedValue(VALID_PUBKEY),
      signTransaction,
      submitTransaction,
    });
    mockSimulate.mockResolvedValue(successfulSimulation);

    const result = await crossChainRoutingService.executePayment(stellarRoute);

    expect(result).toBe('freighter-hash');
    expect(signTransaction).toHaveBeenCalled();
    expect(mockSignViaDeepLink).not.toHaveBeenCalled();
  });

  it('surfaces simulation failures', async () => {
    mockGetStellarProvider.mockReturnValue({
      getPublicKey: jest.fn().mockResolvedValue(VALID_PUBKEY),
      signTransaction: jest.fn(),
      submitTransaction: jest.fn(),
    });
    mockSimulate.mockResolvedValue({ ...successfulSimulation, success: false, error: 'boom' });

    await expect(crossChainRoutingService.executePayment(stellarRoute)).rejects.toMatchObject({
      code: WalletErrorCode.STREAM_CREATION_FAILED,
    });
  });
});

describe('executeStellarPayment without Freighter (SEP-0007)', () => {
  it('falls back to a SEP-0007 deep link when a Stellar key is known', async () => {
    mockConnection.mockReturnValue({ stellarPublicKey: VALID_PUBKEY });
    mockGetStellarProvider.mockReturnValue(null);
    mockSignViaDeepLink.mockResolvedValue('deep-link-hash');

    const result = await crossChainRoutingService.executePayment(stellarRoute);

    expect(result).toBe('deep-link-hash');
    expect(mockSignViaDeepLink).toHaveBeenCalledWith(
      expect.objectContaining({ pubkey: VALID_PUBKEY })
    );
  });

  it('accepts the connection address when it is a Stellar key', async () => {
    mockConnection.mockReturnValue({ address: VALID_PUBKEY });
    mockGetStellarProvider.mockReturnValue(null);
    mockSignViaDeepLink.mockResolvedValue('address-hash');

    const result = await crossChainRoutingService.executePayment(stellarRoute);

    expect(result).toBe('address-hash');
  });

  it('throws NOT_CONNECTED when no wallet app handles the deep link', async () => {
    mockConnection.mockReturnValue({ stellarPublicKey: VALID_PUBKEY });
    mockGetStellarProvider.mockReturnValue(null);
    mockSignViaDeepLink.mockResolvedValue(null);

    await expect(crossChainRoutingService.executePayment(stellarRoute)).rejects.toMatchObject({
      code: WalletErrorCode.NOT_CONNECTED,
    });
  });

  it('throws NOT_CONNECTED when no Stellar key is known', async () => {
    mockConnection.mockReturnValue({ address: '0xdeadbeef' });
    mockGetStellarProvider.mockReturnValue(null);

    await expect(crossChainRoutingService.executePayment(stellarRoute)).rejects.toMatchObject({
      code: WalletErrorCode.NOT_CONNECTED,
    });
    expect(mockSignViaDeepLink).not.toHaveBeenCalled();
  });
});

describe('findPaymentRoute', () => {
  it('returns an instant same-chain route', async () => {
    const route = await crossChainRoutingService.findPaymentRoute({
      sourceChainType: ChainType.STELLAR,
      sourceChainId: 0x8000,
      targetChainType: ChainType.STELLAR,
      targetChainId: 0x8000,
      tokenSymbol: 'XLM',
      amount: '5',
    });

    expect(route.estimatedTime).toBe('instant');
    expect(route.tokenAddress).toBe('XLM');
  });

  it('rejects unsupported cross-chain combinations', async () => {
    await expect(
      crossChainRoutingService.findPaymentRoute({
        sourceChainType: ChainType.STELLAR,
        sourceChainId: 0x8000,
        targetChainType: ChainType.EVM,
        targetChainId: 1,
        tokenSymbol: 'XLM',
        amount: '5',
      })
    ).rejects.toBeInstanceOf(WalletError);
  });
});
