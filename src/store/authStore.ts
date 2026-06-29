/**
 * authStore.ts — Authentication state with Zustand v5 persist middleware
 *
 * Schema v1: { token, userId, isAuthenticated }
 * Schema v2: flattens nested `user` object (migration from hypothetical v0 shape)
 *
 * Persisted (whitelisted):  token, userId, isAuthenticated
 * Ephemeral (skipped):      isLoading, error
 *
 * Edge cases:
 *  - Corrupted / truncated storage → resets to defaults + console.warn
 *  - null / undefined token        → treated as signed-out
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  displayName?: string;
}

interface AuthState {
  // Persisted fields
  token: string | null;
  userId: string | null;
  isAuthenticated: boolean;

  // Ephemeral (never persisted)
  isLoading: boolean;
  error: string | null;

  // Actions
  signIn: (token: string, user: AuthUser) => void;
  signOut: () => void;
  setToken: (token: string | null) => void;
  setLoading: (loading: boolean) => void;
  clearError: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persisted slice type (whitelist only)
// ─────────────────────────────────────────────────────────────────────────────

type PersistedAuthSlice = Pick<AuthState, 'token' | 'userId' | 'isAuthenticated'>;

// ─────────────────────────────────────────────────────────────────────────────
// Schema defaults
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_STATE: PersistedAuthSlice = {
  token: null,
  userId: null,
  isAuthenticated: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Schema migration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Migrate persisted auth state between schema versions.
 *
 * v0 → v1: no-op (initial schema)
 * v1 → v2: flatten nested `user` object → flat `userId`
 */
function migrateAuthState(persisted: unknown, fromVersion: number): PersistedAuthSlice {
  if (!persisted || typeof persisted !== 'object') {
    console.warn('[authStore] Corrupted persisted state — resetting to defaults.');
    return { ...DEFAULT_STATE };
  }

  const raw = persisted as Record<string, unknown>;

  // v0 → v1: nothing to do, just normalize
  if (fromVersion < 1) {
    return {
      token: typeof raw.token === 'string' ? raw.token : null,
      userId: typeof raw.userId === 'string' ? raw.userId : null,
      isAuthenticated: raw.isAuthenticated === true,
    };
  }

  // v1 → v2: flatten nested `user` shape, e.g. { user: { id, email } }
  if (fromVersion < 2) {
    const userId =
      typeof raw.userId === 'string'
        ? raw.userId
        : typeof raw.user === 'object' && raw.user !== null
          ? (((raw.user as Record<string, unknown>).id as string | null) ?? null)
          : null;

    return {
      token: typeof raw.token === 'string' ? raw.token : null,
      userId,
      isAuthenticated: raw.isAuthenticated === true && raw.token != null,
    };
  }

  return {
    token: typeof raw.token === 'string' ? raw.token : null,
    userId: typeof raw.userId === 'string' ? raw.userId : null,
    isAuthenticated: raw.isAuthenticated === true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = '@subtrackr/auth_token';
const STORE_VERSION = 2;

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,
      isLoading: false,
      error: null,

      signIn: (token, user) => {
        set({
          token,
          userId: user.id,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
      },

      signOut: () => {
        set({
          token: null,
          userId: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
        });
      },

      setToken: (token) => {
        set({ token, isAuthenticated: token != null });
      },

      setLoading: (loading) => set({ isLoading: loading }),

      clearError: () => set({ error: null }),
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => asyncStorageAdapter),

      // Only persist these fields; isLoading and error are ephemeral
      partialize: (state): PersistedAuthSlice => ({
        token: state.token,
        userId: state.userId,
        isAuthenticated: state.isAuthenticated,
      }),

      migrate: (persistedState, version) =>
        migrateAuthState(persistedState, version) as PersistedAuthSlice,

      merge: (persistedState, currentState) => ({
        ...currentState,
        ...migrateAuthState(persistedState, STORE_VERSION),
      }),

      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.warn('[authStore] Hydration error — resetting auth state:', error);
          useAuthStore.setState({
            ...DEFAULT_STATE,
            isLoading: false,
            error: null,
          });
          return;
        }

        // Sanity-check: if token is missing but isAuthenticated is true, fix it
        if (state && state.isAuthenticated && !state.token) {
          console.warn('[authStore] Inconsistent auth state detected — signing out.');
          useAuthStore.setState({
            token: null,
            userId: null,
            isAuthenticated: false,
            isLoading: false,
            error: null,
          });
        }
      },
    }
  )
);

// ─────────────────────────────────────────────────────────────────────────────
// Selectors
// ─────────────────────────────────────────────────────────────────────────────

export const selectIsAuthenticated = (s: AuthState) => s.isAuthenticated;
export const selectAuthToken = (s: AuthState) => s.token;
export const selectUserId = (s: AuthState) => s.userId;
