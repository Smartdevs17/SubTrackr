import { rpc, TransactionBuilder } from '@stellar/stellar-sdk';

import {
  normalizeStellarSimulation,
  parseStellarTransaction,
  simulateStellarTransaction,
  stroopsToXlm,
  STROOPS_PER_XLM,
} from '../stellarTransactionService';
import { WalletError, WalletErrorCode } from '../walletService';

jest.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      simulateTransaction: jest.fn(),
    })),
  },
  TransactionBuilder: {
    fromXDR: jest.fn(),
  },
}));

const mockServer = rpc.Server as unknown as jest.Mock;
const mockFromXDR = TransactionBuilder.fromXDR as jest.Mock;

const mockServerInstance = {
  simulateTransaction: jest.fn(),
};

describe('stroopsToXlm', () => {
  it('converts stroops to an XLM string with seven decimals', () => {
    expect(stroopsToXlm(STROOPS_PER_XLM)).toBe('1.0000000');
    expect(stroopsToXlm(100 * STROOPS_PER_XLM)).toBe('100.0000000');
    expect(stroopsToXlm(123456789)).toBe('12.3456789');
  });
});

describe('parseStellarTransaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockServer.mockImplementation(() => mockServerInstance);
  });

  it('returns parsed transaction details', () => {
    mockFromXDR.mockReturnValue({
      source: 'GB1234EXAMPLE',
      fee: 100,
      operations: [{ type: 'payment' }, { type: 'invokeHostFunction' }],
    });

    const parsed = parseStellarTransaction('AAAA...');

    expect(parsed.source).toBe('GB1234EXAMPLE');
    expect(parsed.feeStroops).toBe(100);
    expect(parsed.operations).toBe('payment, invokeHostFunction');
  });

  it('throws a WalletError with code INVALID_PARAMS when XDR is malformed', () => {
    mockFromXDR.mockImplementation(() => {
      throw new Error('Unable to decode XDR');
    });

    try {
      parseStellarTransaction('not-an-xdr');
      throw new Error('Expected parseStellarTransaction to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(WalletError);
      expect((error as WalletError).code).toBe(WalletErrorCode.INVALID_PARAMS);
    }
  });
});

describe('simulateStellarTransaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockServer.mockImplementation(() => mockServerInstance);
  });

  it('returns fee and storage estimates for a successful simulation', async () => {
    mockFromXDR.mockReturnValue({
      fee: 100,
      operations: [],
    });
    mockServerInstance.simulateTransaction.mockResolvedValue({
      error: '',
      minResourceFee: '100100',
      transactionData: {
        resources: () => ({
          footprint: () => ({
            readOnly: Array.from({ length: 2 }),
            readWrite: Array.from({ length: 1 }),
          }),
          readBytes: 128,
          writeBytes: 64,
          instructions: 2_000_000,
        }),
      },
      cost: { cpuInsns: 2_100_000, memBytes: 8192 },
    });

    const result = await simulateStellarTransaction('AAAA...');

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.fees.inclusionFeeStroops).toBe(100);
    expect(result.fees.resourceFeeStroops).toBe(100100);
    expect(result.fees.totalFeeStroops).toBe(100200);
    expect(result.fees.totalFeeXlm).toBe(stroopsToXlm(100200));
    expect(result.storage.readBytes).toBe(128);
    expect(result.storage.writeBytes).toBe(64);
    expect(result.storage.diskBytes).toBe(192);
    expect(result.storage.memoryBytes).toBe(8192);
    expect(result.storage.instructions).toBe(2_100_000);
    expect(result.storage.readOnlyEntries).toBe(2);
    expect(result.storage.readWriteEntries).toBe(1);
  });

  it('falls back to resource metrics when cost is absent', async () => {
    mockFromXDR.mockReturnValue({ fee: 0 });
    mockServerInstance.simulateTransaction.mockResolvedValue({
      error: '',
      transactionData: {
        resources: () => ({
          footprint: () => ({ readOnly: [], readWrite: [] }),
          instructions: 500_000,
          readBytes: 0,
          writeBytes: 0,
        }),
      },
    });

    const result = await simulateStellarTransaction('AAAA...');

    expect(result.success).toBe(true);
    expect(result.storage.instructions).toBe(500_000);
    expect(result.fees.resourceFeeStroops).toBe(0);
  });

  it('reports a failed simulation with the host error message', async () => {
    mockFromXDR.mockReturnValue({ fee: 100 });
    mockServerInstance.simulateTransaction.mockResolvedValue({
      error: 'HostError: Insufficient balance to pay for the transaction',
      transactionData: null,
      minResourceFee: '0',
    });

    const result = await simulateStellarTransaction('AAAA...');

    expect(result.success).toBe(false);
    expect(result.error).toContain('HostError');
    expect(result.fees.totalFeeStroops).toBe(0);
    expect(result.storage.readOnlyEntries).toBe(0);
  });

  it('throws a WalletError with code INVALID_PARAMS for a malformed envelope', async () => {
    mockFromXDR.mockImplementation(() => {
      throw new Error('Unable to decode XDR');
    });

    try {
      await simulateStellarTransaction('not-an-xdr');
      throw new Error('Expected simulateStellarTransaction to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(WalletError);
      expect((error as WalletError).code).toBe(WalletErrorCode.INVALID_PARAMS);
    }
  });

  it('throws a WalletError with code GAS_ESTIMATION_FAILED when the RPC call fails', async () => {
    mockFromXDR.mockReturnValue({ fee: 100 });
    mockServerInstance.simulateTransaction.mockRejectedValue(new Error('connection refused'));

    try {
      await simulateStellarTransaction('AAAA...');
      throw new Error('Expected simulateStellarTransaction to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(WalletError);
      expect((error as WalletError).code).toBe(WalletErrorCode.GAS_ESTIMATION_FAILED);
    }
  });
});

describe('normalizeStellarSimulation', () => {
  it('marks the simulation as successful when no error is present', () => {
    const result = normalizeStellarSimulation(
      {
        error: '',
        minResourceFee: '5000',
        transactionData: null,
        cost: null,
      },
      100
    );

    expect(result.success).toBe(true);
    expect(result.fees.totalFeeStroops).toBe(5100);
  });

  it('marks the simulation as failed when an error is present', () => {
    const result = normalizeStellarSimulation({ error: 'HostError: Boom' }, 100);

    expect(result.success).toBe(false);
    expect(result.error).toBe('HostError: Boom');
  });
});
