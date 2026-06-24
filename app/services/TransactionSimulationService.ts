import AsyncStorage from '@react-native-async-storage/async-storage';
import { SimulateTransactionDto, SimulationResponseDto, SimulationErrorCode } from '../../shared/types/simulation';

const SIMULATION_API_URL = 'http://localhost:3000/transactions/simulate'; // Adjust dynamically based on env if needed
const MAX_SIMULATION_AGE_SECONDS = 60;
const CACHE_KEY_PREFIX = '@simulation_';

export class TransactionSimulationService {
  async simulateTransaction(dto: SimulateTransactionDto): Promise<SimulationResponseDto> {
    try {
      const response = await fetch(SIMULATION_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dto),
      });

      if (!response.ok) {
        throw new Error('Simulation service unavailable');
      }

      const result: SimulationResponseDto = await response.json();

      // Cache the result
      await this.cacheResult(dto.transactionXdr, result);

      return result;
    } catch (error) {
      // Offline mode fallback / network error
      console.warn('Simulation unavailable. Transaction can still be submitted, but may fail on-chain.', error);

      return {
        success: false,
        predictedErrors: [SimulationErrorCode.NETWORK_ERROR],
        simulationTimestamp: new Date().toISOString(),
      };
    }
  }

  private async cacheResult(xdr: string, result: SimulationResponseDto): Promise<void> {
    const key = `${CACHE_KEY_PREFIX}${this.hashXdr(xdr)}`;
    await AsyncStorage.setItem(key, JSON.stringify({
      timestamp: Date.now(),
      result
    }));
  }

  async getCachedSimulation(xdr: string): Promise<SimulationResponseDto | null> {
    const key = `${CACHE_KEY_PREFIX}${this.hashXdr(xdr)}`;
    const cachedStr = await AsyncStorage.getItem(key);

    if (!cachedStr) return null;

    const cached = JSON.parse(cachedStr);
    const ageSeconds = (Date.now() - cached.timestamp) / 1000;

    if (ageSeconds > MAX_SIMULATION_AGE_SECONDS) {
      await AsyncStorage.removeItem(key);
      return null;
    }

    return cached.result;
  }

  private hashXdr(xdr: string): string {
    // Simple hash function for demo purposes
    let hash = 0;
    for (let i = 0; i < xdr.length; i++) {
      const char = xdr.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}


  /**
   * Helps handle the state drift edge case.
   * If a transaction submission fails AFTER a successful simulation,
   */
  handleSubmissionError(error: any): never {
    const errorMsg = error?.message?.toLowerCase() || '';
    const isStateDrift =
      errorMsg.includes('sequence') ||
      errorMsg.includes('bad_seq') ||
      errorMsg.includes('stale') ||
      errorMsg.includes('tx_bad_seq') ||
      errorMsg.includes('state changed');

    if (isStateDrift) {
      throw new Error('Transaction was valid during simulation, but network state changed before submission. Please re-simulate and try again.');
    }

    throw error;
  }
}

export const transactionSimulationService = new TransactionSimulationService();
