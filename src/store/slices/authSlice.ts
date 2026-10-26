/**
 * authSlice.ts — Authentication slice for the slices-pattern store.
 *
 * This isolates all authentication state + actions so it can be composed into
 * the combined `useAppStore`. The public `useAuthStore` (see ../authStore.ts)
 * now re-exports the combined slice so consumers are unaffected.
 */

import { SliceCreator } from './types';
import type { AppState } from './state';

export type AuthStoreState = AppState & AuthSlice;

export interface AuthUser {
  id: string;
  email: string;
  displayName?: string;
}

export interface AuthSlice {
  token: string | null;
  userId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  signIn: (token: string, user: AuthUser) => void;
  signOut: () => void;
  setToken: (token: string | null) => void;
  setLoading: (loading: boolean) => void;
  clearError: () => void;
}

export const createAuthSlice: SliceCreator<AuthSlice> = (set) => ({
  token: null,
  userId: null,
  isAuthenticated: false,
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
});
