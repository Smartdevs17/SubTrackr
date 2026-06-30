import { ethers } from 'ethers';
import { TokenService } from '../tokenService';
import { GasService } from '../gasService';
import { ERC20__factory, getContractAddress } from '../../contracts';

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers') as Record<string, unknown>;
  return {
    ...actual,
    providers: {
      JsonRpcProvider: jest.fn().mockImplementation(() => ({
        getBalance: jest.fn(),
        getGasPrice: jest.fn(),
        estimateGas: jest.fn(),
      })),
      Web3Provider: jest.fn().mockImplementation(() => ({
        getSigner: jest.fn(),
      })),
    },
  };
});

jest.mock('../../contracts', () => ({
  ERC20__factory: {
    connect: jest.fn(),
  },
  getContractAddress: jest.fn(),
}));

jest.mock('../../config/evm', () => ({
  getEvmRpcUrl: jest.fn().mockReturnValue('https://rpc.example.com'),
}));

describe('TokenService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns native and USDC balances for supported chains', async () => {
    const tokenService = new TokenService();
    const mockProvider = {
      getBalance: jest.fn().mockResolvedValue(ethers.BigNumber.from('1000000000000000000')),
    };

    jest
      .spyOn(ethers.providers, 'JsonRpcProvider')
      .mockImplementation(() => mockProvider as unknown as ethers.providers.JsonRpcProvider);

    (getContractAddress as jest.Mock).mockReturnValue('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    (ERC20__factory.connect as jest.Mock).mockReturnValue({
      balanceOf: jest.fn().mockResolvedValue(ethers.BigNumber.from('5000000')),
    });

    const balances = await tokenService.getTokenBalances('0xAddr', 1);

    expect(balances[0].symbol).toBe('ETH');
    expect(balances.find((balance) => balance.symbol === 'USDC')?.balance).toBe('5.0');
  });
});

describe('GasService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('estimates gas with a fallback gas limit when estimation fails', async () => {
    const gasService = new GasService({
      getProvider: () =>
        ({
          getGasPrice: jest.fn().mockResolvedValue(ethers.BigNumber.from('20000000000')),
          estimateGas: jest.fn().mockRejectedValue(new Error('failed')),
        }) as unknown as ethers.providers.JsonRpcProvider,
    });

    const estimate = await gasService.estimateGas('0xFrom', '0xTo', '1.0', 1);

    expect(estimate.gasLimit).toBeDefined();
    expect(estimate.gasPrice).toBe('20.0');
    expect(parseFloat(estimate.estimatedCost)).toBeGreaterThan(0);
  });
});
