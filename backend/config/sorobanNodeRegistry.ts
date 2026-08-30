/**
 * Soroban RPC node registry — endpoints and metadata for decentralized selection.
 * Issue #612
 */

export type SorobanNetwork = 'testnet' | 'mainnet' | 'futurenet';

export interface SorobanNodeConfig {
  /** Unique node identifier */
  id: string;
  /** Human-readable label */
  name: string;
  /** RPC endpoint URL */
  endpoint: string;
  /** Stellar/Soroban network */
  network: SorobanNetwork;
  /** Optional priority hint (lower = preferred when scores tie) */
  priority?: number;
  /** Arbitrary metadata (region, provider, etc.) */
  metadata?: Record<string, string>;
}

/** Default Soroban RPC nodes for testnet and mainnet */
export const DEFAULT_SOROBAN_NODES: SorobanNodeConfig[] = [
  {
    id: 'soroban-testnet-primary',
    name: 'Stellar Testnet RPC (Primary)',
    endpoint: 'https://soroban-testnet.stellar.org',
    network: 'testnet',
    priority: 1,
    metadata: { provider: 'stellar', region: 'us-east' },
  },
  {
    id: 'soroban-testnet-secondary',
    name: 'Stellar Testnet RPC (Secondary)',
    endpoint: 'https://soroban-testnet-alt.stellar.org',
    network: 'testnet',
    priority: 2,
    metadata: { provider: 'stellar', region: 'eu-west' },
  },
  {
    id: 'soroban-mainnet-primary',
    name: 'Stellar Mainnet RPC (Primary)',
    endpoint: 'https://soroban-mainnet.stellar.org',
    network: 'mainnet',
    priority: 1,
    metadata: { provider: 'stellar', region: 'us-east' },
  },
  {
    id: 'soroban-mainnet-secondary',
    name: 'Stellar Mainnet RPC (Secondary)',
    endpoint: 'https://soroban-mainnet-alt.stellar.org',
    network: 'mainnet',
    priority: 2,
    metadata: { provider: 'stellar', region: 'ap-southeast' },
  },
];

export class SorobanNodeRegistry {
  private nodes = new Map<string, SorobanNodeConfig>();

  constructor(initialNodes: SorobanNodeConfig[] = DEFAULT_SOROBAN_NODES) {
    for (const node of initialNodes) {
      this.register(node);
    }
  }

  register(node: SorobanNodeConfig): void {
    if (!node.id || !node.endpoint) {
      throw new Error('Node id and endpoint are required');
    }
    this.nodes.set(node.id, { ...node });
  }

  unregister(nodeId: string): boolean {
    return this.nodes.delete(nodeId);
  }

  get(nodeId: string): SorobanNodeConfig | undefined {
    return this.nodes.get(nodeId);
  }

  getAll(): SorobanNodeConfig[] {
    return [...this.nodes.values()];
  }

  getByNetwork(network: SorobanNetwork): SorobanNodeConfig[] {
    return this.getAll().filter((n) => n.network === network);
  }
}

export const sorobanNodeRegistry = new SorobanNodeRegistry();
