/**
 * @deprecated Use `useStore` from `./combinedStore` instead.
 *
 * This file re-exports the combined Zustand store for backward compatibility.
 * All stores are now combined into a single store using the slices pattern.
 * See `./combinedStore.ts` and `./slices/` for the new architecture.
 */
export { useStore as useSubscriptionStore } from './combinedStore';
