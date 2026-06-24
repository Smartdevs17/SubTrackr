import { rpc, Transaction, Networks } from '@stellar/stellar-sdk';
import { logger } from '../../services/shared/logging';
import { SimulationError } from '../simulation.error';
import { SimulationErrorCode } from '../../../shared/types/simulation';

export class SorobanSimulationClient {
  private rpcClients: Record<string, rpc.Server> = {};

  constructor() {
    this.rpcClients['testnet'] = new rpc.Server('https://soroban-testnet.stellar.org');
    this.rpcClients['public'] = new rpc.Server('https://soroban-rpc.mainnet.stellar.org');
  }

  async simulateTransaction(network: 'testnet' | 'public', transactionXdr: string): Promise<any> {
    const rpcClient = this.rpcClients[network];
    if (!rpcClient) {
      throw new Error(`Unsupported network: ${network}`);
    }

    try {
      logger.info(`Simulating transaction on ${network}`, { transactionXdr: transactionXdr.substring(0, 20) + '...' });

      const tx = new Transaction(transactionXdr, network === 'public' ? Networks.PUBLIC : Networks.TESTNET);
      const response = await rpcClient.simulateTransaction(tx);

      return response;
    } catch (error: any) {
      logger.error('Error calling Soroban RPC for simulation', { error: error.message });
      throw SimulationError.fromCode(SimulationErrorCode.NETWORK_ERROR, error);
    }
  }
}

export const sorobanSimulationClient = new SorobanSimulationClient();
