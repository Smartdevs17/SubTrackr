/**
 * mobile/src/wallet/types.ts
 *
 * Contracts shared by the Freighter and WalletConnect v2 adapters and by the
 * connect flow. All modules in this directory are free of React Native imports
 * so they can be exercised with the TypeScript Jest configuration.
 */

export type WalletKind = 'freighter' | 'walletconnect-v2';

export type WalletNetwork = 'stellar' | 'evm';

export type WalletConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface WalletAccount {
  address: string;
  network: WalletNetwork;
  chainId?: string | number;
  publicKey?: string;
}

export interface WalletSession {
  kind: WalletKind;
  account: WalletAccount;
  connectedAt: number;
  pairingTopic?: string;
}

export interface WalletConnectRequest {
  /** CAIP-2 chain identifiers, e.g. `eip155:1` or `stellar:pubnet`. */
  chains?: string[];
  methods?: string[];
}

export interface WalletAdapter {
  readonly kind: WalletKind;
  connect(request?: WalletConnectRequest): Promise<WalletSession>;
  disconnect(): Promise<void>;
  restore?(session: WalletSession): Promise<WalletSession | null>;
}

export interface WalletStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface WalletLogger {
  debug?(message: string, meta?: Record<string, unknown>): void;
  info?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
}

export interface WalletMetrics {
  increment?(name: string, value?: number, tags?: Record<string, string>): void;
  timing?(name: string, milliseconds: number, tags?: Record<string, string>): void;
}

export interface WalletState {
  status: WalletConnectionStatus;
  session: WalletSession | null;
  error: string | null;
  isConnecting: boolean;
}

export interface WalletConnectFlow {
  getState(): WalletState;
  subscribe(listener: (state: WalletState) => void): () => void;
  connect(kind: WalletKind, request?: WalletConnectRequest): Promise<WalletSession>;
  restore(): Promise<WalletSession | null>;
  disconnect(): Promise<void>;
}

export const WALLET_STORAGE_KEY = '@subtrackr_wallet_session';

export const WALLETCONNECT_METHODS = [
  'eth_sendTransaction',
  'personal_sign',
  'eth_signTypedData_v4',
  'wallet_switchEthereumChain',
];
