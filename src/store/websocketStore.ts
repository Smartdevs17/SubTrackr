/**
 * WebSocket connection state store
 *
 * Manages the lifecycle, metrics, and configuration of the real-time
 * WebSocket connection used across the app.
 *
 * Usage:
 *   const { state, metrics, connect, disconnect } = useWebSocketStore();
 */

import { create } from 'zustand';
import { realtimeService, RealtimeMetrics } from '../services/realtimeService';
import type { EventFilter, SubscriptionEvent } from '../../backend/services/notification/websocket';
import type { EventHandler } from '../services/realtimeService';

interface WebSocketState {
  /** Current connection state mirrored from RealtimeService */
  state: RealtimeMetrics['state'];
  /** Live metrics snapshot (updated on each metrics poll) */
  metrics: RealtimeMetrics;
  /** WebSocket server URL */
  url: string;
  /** Whether to auto-reconnect on network change */
  autoReconnect: boolean;

  // ── Actions ─────────────────────────────────────────────────────────────

  /** Configure the server URL and initiate connection */
  connect: (url: string) => void;
  /** Gracefully disconnect */
  disconnect: () => void;
  /** Subscribe to events; returns unsubscribe function */
  subscribe: (handler: EventHandler, filter?: EventFilter) => () => void;
  /** Refresh the metrics snapshot from the service */
  refreshMetrics: () => void;
  /** Enable / disable auto-reconnect behaviour */
  setAutoReconnect: (enabled: boolean) => void;
}

const DEFAULT_METRICS: RealtimeMetrics = {
  state: 'disconnected',
  reconnectAttempts: 0,
  messagesReceived: 0,
  messagesDeliveredToSubscribers: 0,
  messagesDropped: 0,
  batchesProcessed: 0,
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  lastPingAt: null,
  lastPongAt: null,
};

export const useWebSocketStore = create<WebSocketState>((set, get) => ({
  state: 'disconnected',
  metrics: DEFAULT_METRICS,
  url: '',
  autoReconnect: true,

  connect(url: string) {
    // Re-configure singleton when URL changes
    const current = get();
    if (current.url !== url) {
      // Build a new service instance is not possible on the singleton, so
      // we just reconnect with the updated URL by using the private cfg.
      // The singleton accepts empty URL on creation — set it here.
      (realtimeService as unknown as { cfg: { url: string } }).cfg.url = url;
    }

    set({ url, state: 'connecting' });
    realtimeService.connect();

    // Poll metrics every 5 s while connected
    const pollId = setInterval(() => {
      if (!realtimeService.connected) {
        clearInterval(pollId);
      }
      get().refreshMetrics();
    }, 5_000);
  },

  disconnect() {
    realtimeService.disconnect();
    set({ state: 'disconnected', metrics: { ...DEFAULT_METRICS, state: 'disconnected' } });
  },

  subscribe(handler: EventHandler, filter?: EventFilter): () => void {
    return realtimeService.subscribe(handler, filter ?? {});
  },

  refreshMetrics() {
    const m = realtimeService.metrics;
    set({ state: m.state, metrics: { ...m } });
  },

  setAutoReconnect(enabled: boolean) {
    set({ autoReconnect: enabled });
  },
}));

// ── Typed hook aliases ────────────────────────────────────────────────────────

export const useWebSocketState = () => useWebSocketStore((s) => s.state);

export const useWebSocketMetrics = () => useWebSocketStore((s) => s.metrics);

export const useWebSocketActions = () =>
  useWebSocketStore((s) => ({
    connect: s.connect,
    disconnect: s.disconnect,
    subscribe: s.subscribe,
    refreshMetrics: s.refreshMetrics,
    setAutoReconnect: s.setAutoReconnect,
  }));

// ── Subscription event helper ─────────────────────────────────────────────────

/**
 * Subscribe to all subscription events for a given user.
 * Returns the unsubscribe function — call it in a useEffect cleanup.
 */
export function subscribeToUserEvents(userId: string, handler: EventHandler): () => void {
  return realtimeService.subscribe(handler, { userId });
}

/**
 * Subscribe to a specific list of subscription IDs.
 */
export function subscribeToSubscriptions(
  subscriptionIds: string[],
  handler: (event: SubscriptionEvent) => void
): () => void {
  return realtimeService.subscribe(handler, { subscriptionIds });
}
