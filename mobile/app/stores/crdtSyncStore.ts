/**
 * CRDT Sync Store (Zustand)
 *
 * Exposes CRDT queue status and sync controls to the rest of the app.
 * Integrates with NetInfo for automatic sync-on-reconnect behaviour,
 * mirroring the existing transactionQueueStore pattern.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoSubscription } from '@react-native-community/netinfo';
import { CRDTConflict } from '../../../../shared/types/crdt';
import { OfflineMutationQueue, OfflineMutation, QueueStats } from '../services/offline/queue';
import CRDTService from '../services/offline/crdtService';

// ── Config ────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'subtrackr-crdt-sync-store';
const SYNC_ENDPOINT = '/api/sync/crdt';

// ── State interface ───────────────────────────────────────────────────────────

interface CRDTSyncState {
  nodeId: string;
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  pendingCount: number;
  conflicts: CRDTConflict[];
  mutations: OfflineMutation[];

  // Actions
  initialize: (nodeId: string) => Promise<void>;
  initializeConnectivityListener: () => () => void;
  enqueueFieldSet: (params: {
    entityId: string;
    entityType: string;
    field: string;
    value: unknown;
    label: string;
  }) => void;
  syncNow: () => Promise<void>;
  resolveConflict: (mutationId: string, resolvedValue: unknown) => void;
  clearSynced: () => void;
  refreshStats: () => void;
}

// ── Connectivity helper ───────────────────────────────────────────────────────

let connectivitySubscription: NetInfoSubscription | null = null;

const isOnlineState = (
  isConnected: boolean | null,
  isInternetReachable: boolean | null,
): boolean => Boolean(isConnected) && isInternetReachable !== false;

// ── Store ─────────────────────────────────────────────────────────────────────

export const useCRDTSyncStore = create<CRDTSyncState>()(
  persist(
    (set, get) => ({
      nodeId: '',
      isOnline: true,
      isSyncing: false,
      lastSyncedAt: null,
      lastError: null,
      pendingCount: 0,
      conflicts: [],
      mutations: [],

      initialize: async (nodeId: string) => {
        set({ nodeId });
        CRDTService.getInstance(nodeId);
        const queue = OfflineMutationQueue.getInstance(nodeId);
        await queue.initialize();
        queue.subscribe(() => get().refreshStats());
        get().refreshStats();
      },

      initializeConnectivityListener: () => {
        if (connectivitySubscription) {
          return () => {
            connectivitySubscription?.();
            connectivitySubscription = null;
          };
        }

        connectivitySubscription = NetInfo.addEventListener((state) => {
          const online = isOnlineState(state.isConnected, state.isInternetReachable);
          const wasOnline = get().isOnline;
          set({ isOnline: online });

          if (!wasOnline && online && get().pendingCount > 0) {
            void get().syncNow();
          }
        });

        return () => {
          connectivitySubscription?.();
          connectivitySubscription = null;
        };
      },

      enqueueFieldSet: (params) => {
        const { nodeId } = get();
        const queue = OfflineMutationQueue.getInstance(nodeId);
        queue.enqueue({
          entityId: params.entityId,
          entityType: params.entityType,
          field: params.field,
          type: 'lww_set',
          value: params.value,
          label: params.label,
        });
        get().refreshStats();
      },

      syncNow: async () => {
        if (get().isSyncing || !get().isOnline) return;
        set({ isSyncing: true, lastError: null });

        try {
          const { nodeId } = get();
          const queue = OfflineMutationQueue.getInstance(nodeId);
          const conflicts = await queue.flush(SYNC_ENDPOINT);
          set({
            lastSyncedAt: new Date().toISOString(),
            conflicts,
          });
        } catch (err) {
          set({
            lastError: err instanceof Error ? err.message : 'Sync failed',
          });
        } finally {
          set({ isSyncing: false });
          get().refreshStats();
        }
      },

      resolveConflict: (mutationId: string, resolvedValue: unknown) => {
        const { nodeId } = get();
        const queue = OfflineMutationQueue.getInstance(nodeId);
        queue.resolveConflict(mutationId, resolvedValue);
        get().refreshStats();
      },

      clearSynced: () => {
        const { nodeId } = get();
        OfflineMutationQueue.getInstance(nodeId).clearSynced();
        get().refreshStats();
      },

      refreshStats: () => {
        const { nodeId } = get();
        const queue = OfflineMutationQueue.getInstance(nodeId);
        const stats = queue.getStats();
        set({
          pendingCount: stats.pending,
          mutations: queue.getAll(),
          conflicts: queue.getConflicts().map((m) => m.conflictInfo!).filter(Boolean),
        });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        nodeId: state.nodeId,
        lastSyncedAt: state.lastSyncedAt,
      }),
    },
  ),
);
