import { Network, getNetworkById, ALL_NETWORKS } from '../config/networks';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Server } from '@stellar/stellar-sdk';

const SELECTED_NETWORK_KEY = 'selected_network';

export class NetworkService {
  private currentNetwork: Network | null = null;
  private stellarServer: Server | null = null;

  constructor() {
    this.initializeDefaultNetwork();
  }

  private initializeDefaultNetwork() {
    // Default to Stellar testnet
    this.currentNetwork = getNetworkById('stellar-testnet') || ALL_NETWORKS[0];
  }

  async getSelectedNetwork(): Promise<Network> {
    if (this.currentNetwork) {
      return this.currentNetwork;
    }

    try {
      const stored = await AsyncStorage.getItem(SELECTED_NETWORK_KEY);
      if (stored) {
        const network = getNetworkById(stored);
        if (network) {
          this.currentNetwork = network;
          return network;
        }
      }
    } catch (error) {
      console.error('Error loading selected network:', error);
    }

    return this.currentNetwork || ALL_NETWORKS[0];
  }

  async setSelectedNetwork(networkId: string): Promise<boolean> {
    const network = getNetworkById(networkId);
    if (!network) {
      return false;
    }

    try {
      await AsyncStorage.setItem(SELECTED_NETWORK_KEY, networkId);
      this.currentNetwork = network;

      // Reset Stellar server if switching networks
      if (network.type === 'stellar' && network.horizonUrl) {
        this.stellarServer = new Server(network.horizonUrl);
      } else {
        this.stellarServer = null;
      }

      return true;
    } catch (error) {
      console.error('Error saving selected network:', error);
      return false;
    }
  }

  getStellarServer(): Server | null {
    return this.stellarServer;
  }

  async checkNetworkHealth(networkId: string): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    const network = getNetworkById(networkId);
    if (!network) {
      return { healthy: false, error: 'Network not found' };
    }

    const startTime = Date.now();

    try {
      if (network.type === 'stellar' && network.rpcUrl) {
        // For Stellar, check RPC health
        const response = await fetch(`${network.rpcUrl}/health`, {
          method: 'GET',
          timeout: 5000,
        });

        if (response.ok) {
          const latency = Date.now() - startTime;
          return { healthy: true, latency };
        } else {
          return { healthy: false, error: `HTTP ${response.status}` };
        }
      } else if (network.type === 'evm' && network.rpcUrl) {
        // For EVM, check RPC health by calling eth_blockNumber
        const response = await fetch(network.rpcUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_blockNumber',
            params: [],
            id: 1,
          }),
          timeout: 5000,
        });

        if (response.ok) {
          const data = await response.json();
          if (data.result) {
            const latency = Date.now() - startTime;
            return { healthy: true, latency };
          }
        }
        return { healthy: false, error: 'RPC call failed' };
      }

      return { healthy: false, error: 'Unsupported network type' };
    } catch (error) {
      const latency = Date.now() - startTime;
      return { healthy: false, latency, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getAvailableNetworks(): Promise<Network[]> {
    // In the future, this could filter based on user permissions or custom networks
    return ALL_NETWORKS;
  }

  async addCustomNetwork(network: Omit<Network, 'id'> & { id?: string }): Promise<boolean> {
    // For now, custom networks are not persisted
    // In a full implementation, this would save to AsyncStorage or a database
    console.warn('Custom network addition not implemented yet');
    return false;
  }
}

export const networkService = new NetworkService();