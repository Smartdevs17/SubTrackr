/**
 * mobile/src/wallet/connectFlow.ts
 *
 * Orchestrates Freighter and WalletConnect v2 connections with a single state
 * machine, one persisted session and typed, observable failure modes.
 */

import { isValidWalletAddress } from './addresses';
import { WalletConnectionError, toWalletError } from './errors';
import { WALLET_STORAGE_KEY } from './types';
import type {
  WalletAdapter,
  WalletConnectFlow,
  WalletConnectRequest,
  WalletKind,
  WalletLogger,
  WalletMetrics,
  WalletSession,
  WalletState,
  WalletStorage,
} from './types';

const METRIC_PREFIX = 'subtrackr.wallet';

export interface WalletConnectFlowOptions {
  adapters: WalletAdapter[];
  storage?: WalletStorage;
  storageKey?: string;
  logger?: WalletLogger;
  metrics?: WalletMetrics;
  now?: () => number;
}

function initialState(): WalletState {
  return {
    status: 'disconnected',
    session: null,
    error: null,
    isConnecting: false,
  };
}

export function isWalletSession(value: unknown): value is WalletSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const session = value as Partial<WalletSession>;
  const account = session.account;
  return (
    (session.kind === 'freighter' || session.kind === 'walletconnect-v2') &&
    !!account &&
    typeof account.address === 'string' &&
    isValidWalletAddress(account.address) &&
    (account.network === 'stellar' || account.network === 'evm') &&
    typeof session.connectedAt === 'number'
  );
}

export function createWalletConnectFlow(options: WalletConnectFlowOptions): WalletConnectFlow {
  const adapters = new Map<WalletKind, WalletAdapter>(
    options.adapters.map((adapter) => [adapter.kind, adapter])
  );
  const storage = options.storage;
  const storageKey = options.storageKey ?? WALLET_STORAGE_KEY;
  const log = options.logger;
  const metrics = options.metrics;
  const now = options.now ?? Date.now;

  let state = initialState();
  const listeners = new Set<(next: WalletState) => void>();

  const emit = (): void => {
    for (const listener of listeners) listener(state);
  };

  const setState = (patch: Partial<WalletState>): void => {
    state = { ...state, ...patch };
    emit();
  };

  const persist = async (session: WalletSession | null): Promise<void> => {
    if (!storage) return;
    try {
      if (session) await storage.setItem(storageKey, JSON.stringify(session));
      else await storage.removeItem(storageKey);
    } catch (error) {
      log?.warn?.('Wallet session could not be persisted', {
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  };

  const emitMetric = (name: string, tags?: Record<string, string>): void => {
    metrics?.increment?.(`${METRIC_PREFIX}.${name}`, 1, tags);
  };

  return {
    getState(): WalletState {
      return state;
    },

    subscribe(listener: (next: WalletState) => void): () => void {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },

    async connect(kind: WalletKind, request?: WalletConnectRequest): Promise<WalletSession> {
      if (state.isConnecting) {
        throw new WalletConnectionError(
          'CONNECT_IN_PROGRESS',
          'Another wallet connection is already in progress'
        );
      }
      const adapter = adapters.get(kind);
      if (!adapter) {
        throw new WalletConnectionError('ADAPTER_NOT_FOUND', `No adapter registered for ${kind}`);
      }

      const startedAt = now();
      setState({ status: 'connecting', isConnecting: true, error: null });
      try {
        const session = await adapter.connect(request);
        if (session?.kind !== kind || !isWalletSession(session)) {
          throw new WalletConnectionError('INVALID_SESSION', 'Adapter returned an invalid session');
        }
        await persist(session);
        setState({ status: 'connected', session, isConnecting: false, error: null });
        emitMetric('connected', { kind, network: session.account.network });
        metrics?.timing?.(`${METRIC_PREFIX}.connect`, Math.max(0, now() - startedAt), { kind });
        log?.info?.('Wallet connected', {
          kind,
          network: session.account.network,
          connectedAt: session.connectedAt,
        });
        return session;
      } catch (error) {
        const walletError = toWalletError(error);
        setState({ status: 'error', isConnecting: false, error: walletError.message });
        emitMetric('connect_failed', { kind, code: walletError.code });
        log?.warn?.('Wallet connection failed', { kind, code: walletError.code });
        throw walletError;
      }
    },

    async restore(): Promise<WalletSession | null> {
      if (!storage) return null;
      let raw: string | null;
      try {
        raw = await storage.getItem(storageKey);
      } catch (error) {
        log?.warn?.('Wallet session could not be read', {
          error: error instanceof Error ? error.message : 'unknown',
        });
        return null;
      }
      if (!raw) return null;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
      if (!isWalletSession(parsed)) {
        await persist(null);
        setState(initialState());
        return null;
      }

      const session = parsed;
      const adapter = adapters.get(session.kind);
      if (!adapter) {
        await persist(null);
        setState(initialState());
        return null;
      }

      try {
        const restored = adapter.restore ? await adapter.restore(session) : session;
        if (!restored || !isWalletSession(restored)) {
          await persist(null);
          setState(initialState());
          return null;
        }
        setState({ status: 'connected', session: restored, error: null, isConnecting: false });
        emitMetric('restored', { kind: restored.kind });
        return restored;
      } catch (error) {
        const walletError = toWalletError(error, 'INVALID_SESSION');
        setState({ status: 'error', error: walletError.message, isConnecting: false });
        emitMetric('restore_failed', { kind: session.kind });
        return null;
      }
    },

    async disconnect(): Promise<void> {
      const session = state.session;
      if (session) {
        const adapter = adapters.get(session.kind);
        if (adapter) {
          try {
            await adapter.disconnect();
          } catch (error) {
            const walletError = toWalletError(error, 'DISCONNECT_FAILED');
            emitMetric('disconnect_failed', { kind: session.kind });
            throw walletError;
          }
        }
      }
      await persist(null);
      setState(initialState());
      emitMetric('disconnected', { kind: session?.kind ?? 'none' });
    },
  };
}
