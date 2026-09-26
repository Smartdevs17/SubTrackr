/**
 * authStore.ts — Authentication state (slices pattern).
 *
 * This file now delegates to the combined `useAppStore` (see slices/index.ts)
 * and exposes the legacy `useAuthStore` hook + selectors so all existing
 * consumers continue to work unchanged. The slice itself lives in
 * `slices/authSlice.ts`.
 *
 * Persisted (whitelisted):  token, userId, isAuthenticated
 * Ephemeral (skipped):      isLoading, error
 */

import { useAppStore, AuthSlice } from './slices';

/**
 * Legacy hook — full auth state + actions.
 */
export const useAuthStore = useAppStore;

export type AuthState = AuthSlice;
export interface AuthUser {
  id: string;
  email: string;
  displayName?: string;
}

export const selectIsAuthenticated = (s: AuthState) => s.isAuthenticated;
export const selectAuthToken = (s: AuthState) => s.token;
export const selectUserId = (s: AuthState) => s.userId;
