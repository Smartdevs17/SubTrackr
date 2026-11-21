import { useMemo } from 'react';
import { createStableRowKeySelector } from './keySelectors';
import type { RowKeySelector } from './types';

/** Keep the key-selector identity stable across parent re-renders. */
export function useStableRowKeySelector(namespace = 'subscription'): RowKeySelector {
  return useMemo(() => createStableRowKeySelector(namespace), [namespace]);
}
