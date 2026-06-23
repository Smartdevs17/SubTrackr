/**
 * storage.ts — Shared typed Zustand storage adapters
 *
 * Provides:
 *  - asyncStorageAdapter   : mobile AsyncStorage adapter with corruption resilience
 *  - localStorageAdapter   : web localStorage adapter with corruption resilience
 *  - makeDebouncedAdapter  : factory that wraps any StateStorage with write debouncing
 *
 * Usage in stores:
 *   storage: asyncStorageAdapter
 *   storage: makeDebouncedAdapter(asyncStorageAdapter, 300)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { type StateStorage } from 'zustand/middleware';

// ─────────────────────────────────────────────────────────────────────────────
// AsyncStorage adapter (mobile)
// ─────────────────────────────────────────────────────────────────────────────

export const asyncStorageAdapter: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      return await AsyncStorage.getItem(name);
    } catch (err) {
      console.warn(`[storage] Failed to read key "${name}" from AsyncStorage:`, err);
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      await AsyncStorage.setItem(name, value);
    } catch (err) {
      console.warn(`[storage] Failed to write key "${name}" to AsyncStorage:`, err);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await AsyncStorage.removeItem(name);
    } catch (err) {
      console.warn(`[storage] Failed to remove key "${name}" from AsyncStorage:`, err);
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// localStorage adapter (web / developer-portal)
// ─────────────────────────────────────────────────────────────────────────────

export const localStorageAdapter: StateStorage = {
  getItem: (name: string): string | null => {
    try {
      return window.localStorage.getItem(name);
    } catch (err) {
      console.warn(`[storage] Failed to read key "${name}" from localStorage:`, err);
      return null;
    }
  },
  setItem: (name: string, value: string): void => {
    try {
      window.localStorage.setItem(name, value);
    } catch (err) {
      console.warn(`[storage] Failed to write key "${name}" to localStorage:`, err);
    }
  },
  removeItem: (name: string): void => {
    try {
      window.localStorage.removeItem(name);
    } catch (err) {
      console.warn(`[storage] Failed to remove key "${name}" from localStorage:`, err);
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Debounced write adapter factory
//
// Wraps any StateStorage and batches writes within `debounceMs` milliseconds.
// Reads are served from the pending-write cache first, avoiding stale reads.
// ─────────────────────────────────────────────────────────────────────────────

export function makeDebouncedAdapter(
  base: StateStorage,
  debounceMs: number,
): StateStorage {
  const pending = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writeQueue: Promise<void> = Promise.resolve();

  const flush = (): void => {
    if (pending.size === 0) return;
    const writes = Array.from(pending.entries());
    pending.clear();
    writeQueue = writeQueue.then(() =>
      Promise.all(writes.map(([k, v]) => base.setItem(k, v))).then(() => undefined),
    );
  };

  return {
    getItem: async (name: string): Promise<string | null> => {
      // Serve from pending cache to avoid stale-read race conditions
      if (pending.has(name)) return pending.get(name) ?? null;
      await writeQueue;
      return base.getItem(name);
    },
    setItem: async (name: string, value: string): Promise<void> => {
      pending.set(name, value);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    },
    removeItem: async (name: string): Promise<void> => {
      pending.delete(name);
      if (timer && pending.size === 0) {
        clearTimeout(timer);
        timer = null;
      }
      await writeQueue;
      await base.removeItem(name);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-built debounced adapter (300 ms — suitable for most stores)
// ─────────────────────────────────────────────────────────────────────────────
export const debouncedAsyncStorageAdapter = makeDebouncedAdapter(asyncStorageAdapter, 300);
