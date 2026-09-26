export type WalletConnectSessionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'disconnected'
  | 'error';

export interface WalletConnectSessionState {
  status: WalletConnectSessionStatus;
  address: string | null;
  chainId: number | null;
  supportedChainIds: number[];
  connectedAt: string | null;
  lastUpdatedAt: string;
  pairingUri: string;
  sessionTopic: string | null;
  lastError: string | null;
  disconnectReason: string | null;
}

export interface WalletConnectChainDefinition {
  chainId: number;
  caipNetworkId: string;
  name: string;
  currency: string;
  explorerUrl: string;
  rpcUrl: string;
  accentColor: string;
  description: string;
}
