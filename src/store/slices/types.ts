/**
 * types.ts — Shared composition types for the Zustand slices pattern.
 *
 * This module defines the slice creator type used across all store slices so
 * each slice can be expressed independently and then composed into a single
 * combined `useAppStore` (see `slices/index.ts`).
 *
 * The slices pattern (https://docs.pmnd.rs/zustand/guides/slices-pattern)
 * gives us modularity: each domain owns its state + actions in one file, and
 * the root store simply spreads the slices together.
 */

export { SliceCreator, AppState } from './state';

export type { SearchSlice, SearchStoreState } from './searchSlice';

// ─────────────────────────────────────────────────────────────────────────────
// Shared ephemeral-state helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface LoadingState {
  isLoading: boolean;
}

export interface ErrorState {
  error: string | null;
}
