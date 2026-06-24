import { SimulationService } from '../simulation.service';
import { SorobanSimulationClient } from '../connectors/soroban-simulation.client';
import { SimulateTransactionDto } from '../../../shared/types/simulation';
import { SimulationErrorCode } from '../../../shared/types/simulation';

jest.mock('../connectors/soroban-simulation.client');

describe('SimulationService', () => {
  let service: SimulationService;
  let clientMock: jest.Mocked<SorobanSimulationClient>;

  beforeEach(() => {
    clientMock = new SorobanSimulationClient() as jest.Mocked<SorobanSimulationClient>;
    service = new SimulationService(clientMock);
  });

  it('should return successful simulation result', async () => {
    const mockResponse = {
      result: {
        retval: {
          toXDR: () => 'mock_xdr_base64',
        },
      },
      transactionData: {
        build: () => ({
          fee: () => '100',
        }),
      },
      minResourceFee: '100',
    };

    clientMock.simulateTransaction.mockResolvedValue(mockResponse);
    // Overriding isSimulationSuccess for testing
    const rpcApiMock = {
      isSimulationSuccess: jest.fn().mockReturnValue(true),
      isSimulationError: jest.fn().mockReturnValue(false),
    };

    // We mock global rpc to avoid complex stellar-sdk dependency
    (global as any).rpc = { Api: rpcApiMock };

    const dto: SimulateTransactionDto = {
      network: 'testnet',
      transactionXdr: 'mock_tx_xdr',
    };

    const result = await service.simulateTransaction(dto);

    expect(result.success).toBe(true);
    expect(result.expectedResult?.status).toBe('success');
    expect(result.expectedResult?.returnValue).toBe('mock_xdr_base64');
    expect(result.gasEstimate?.estimatedFee).toBe('100');
  });

  it('should return error prediction on simulation failure', async () => {
    const mockResponse = {
      error: 'balance',
    };

    clientMock.simulateTransaction.mockResolvedValue(mockResponse);

    const rpcApiMock = {
      isSimulationSuccess: jest.fn().mockReturnValue(false),
      isSimulationError: jest.fn().mockReturnValue(true),
    };
    (global as any).rpc = { Api: rpcApiMock };

    const dto: SimulateTransactionDto = {
      network: 'testnet',
      transactionXdr: 'mock_tx_xdr',
    };

    const result = await service.simulateTransaction(dto);

    expect(result.success).toBe(false);
    expect(result.predictedErrors).toContain(SimulationErrorCode.INSUFFICIENT_BALANCE);
  });
});
