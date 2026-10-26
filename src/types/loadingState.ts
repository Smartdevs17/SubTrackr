/**
 * Standardized loading state for all async operations in SubTrackr.
 *
 * Every store and screen that performs async work should use this type
 * instead of ad-hoc `isLoading: boolean` + `error: string | null` pairs.
 * This ensures consistent UI treatment across the entire app.
 *
 * Usage in a Zustand store:
 *
 *   import { LoadingState, idle, loading, success, failure } from '../types/loadingState';
 *
 *   interface MyState {
 *     fetchState: LoadingState;
 *     submitState: LoadingState;
 *     // ...
 *   }
 *
 *   // In an action:
 *   set({ fetchState: loading() });
 *   try {
 *     const data = await fetchData();
 *     set({ fetchState: success() });
 *   } catch (e) {
 *     set({ fetchState: failure(e as Error) });
 *   }
 *
 * Usage in a component:
 *
 *   import { AsyncStateView } from '../components/common/AsyncStateView';
 *
 *   <AsyncStateView
 *     state={fetchState}
 *     onRetry={fetchData}
 *     skeleton={<MyListSkeleton />}>
 *     <MyList />
 *   </AsyncStateView>
 */

// ─── Status discriminant ──────────────────────────────────────────────────────

export type LoadingStatus = 'idle' | 'loading' | 'success' | 'error';

// ─── Core type ────────────────────────────────────────────────────────────────

export interface LoadingState {
  /** Current status of the async operation. */
  status: LoadingStatus;
  /**
   * Human-readable error message shown to the user.
   * Only populated when status === 'error'.
   */
  errorMessage: string | null;
  /**
   * Optional recovery suggestions shown below the error message.
   * Mirrors the pattern used in AppError.recoverySuggestions.
   */
  recoverySuggestions: string[];
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

/** Operation has not started yet. */
export const idle = (): LoadingState => ({
  status: 'idle',
  errorMessage: null,
  recoverySuggestions: [],
});

/** Operation is in progress. */
export const loading = (): LoadingState => ({
  status: 'loading',
  errorMessage: null,
  recoverySuggestions: [],
});

/** Operation completed successfully. */
export const success = (): LoadingState => ({
  status: 'success',
  errorMessage: null,
  recoverySuggestions: [],
});

/**
 * Operation failed.
 * @param error  The caught error or a plain message string.
 * @param suggestions  Optional recovery suggestions to show the user.
 */
export const failure = (
  error: Error | string,
  suggestions: string[] = ['Try again', 'Restart the app if the problem persists']
): LoadingState => ({
  status: 'error',
  errorMessage: typeof error === 'string' ? error : error.message,
  recoverySuggestions: suggestions,
});

// ─── Guard helpers ────────────────────────────────────────────────────────────

export const isIdle = (s: LoadingState): boolean => s.status === 'idle';
export const isLoading = (s: LoadingState): boolean => s.status === 'loading';
export const isSuccess = (s: LoadingState): boolean => s.status === 'success';
export const isError = (s: LoadingState): boolean => s.status === 'error';
