/**
 * useAssetMetadata – React hook that resolves and caches asset display metadata
 * (name, logoURI, fallback colour, initials) for a given token symbol.
 *
 * Follows the same useState + useEffect + useRef pattern used by useTokenPrices.
 *
 * Features:
 *   - Synchronous initial state from the static known-asset registry
 *   - Async resolution through the full cache stack on mount / symbol change
 *   - Stable `refresh` callback to force a re-resolve
 *   - Returns `isLoading` and `isKnown` flags for conditional rendering
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getAssetMetadataSync,
  resolveAssetMetadata,
  type AssetMetadata,
} from '../services/assetMetadataService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseAssetMetadataResult {
  /** Resolved display metadata. Always defined — never null. */
  metadata: AssetMetadata;
  /**
   * True while the async cache / registry lookup is in-flight on the first
   * render for this symbol.  Will be false if the synchronous fast-path
   * already returned a known entry.
   */
  isLoading: boolean;
  /** Convenience alias for `metadata.isKnown`. */
  isKnown: boolean;
  /** Re-resolve the metadata (bypasses in-flight dedup, consults fresh cache). */
  refresh: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * @param symbol - Asset ticker (case-insensitive, e.g. "xlm", "USDC")
 */
export function useAssetMetadata(symbol: string): UseAssetMetadataResult {
  // Seed with the synchronous fast-path so the first render has something
  // meaningful without waiting for the async cache round-trip.
  const [metadata, setMetadata] = useState<AssetMetadata>(() =>
    getAssetMetadataSync(symbol),
  );

  // isLoading is only true when we haven't yet confirmed the async result AND
  // the sync fast-path didn't already give us a "known" entry.
  const [isLoading, setIsLoading] = useState<boolean>(
    () => !getAssetMetadataSync(symbol).isKnown,
  );

  const mountedRef = useRef(true);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const resolve = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) return;

    inFlightRef.current = (async () => {
      try {
        const result = await resolveAssetMetadata(symbol);
        if (!mountedRef.current) return;
        setMetadata(result);
      } finally {
        if (mountedRef.current) setIsLoading(false);
        inFlightRef.current = null;
      }
    })();

    return inFlightRef.current;
  }, [symbol]);

  useEffect(() => {
    mountedRef.current = true;
    inFlightRef.current = null;

    // Immediately seed with a synchronous result for the new symbol so the
    // component never shows stale metadata from the previous symbol while the
    // async lookup is in-flight.
    const sync = getAssetMetadataSync(symbol);
    setMetadata(sync);
    setIsLoading(!sync.isKnown);

    void resolve();

    return () => {
      mountedRef.current = false;
    };
  }, [symbol, resolve]);

  const refresh = useCallback((): void => {
    // If there's already an in-flight request, let it complete.
    if (inFlightRef.current) return;
    setIsLoading(true);
    void resolve();
  }, [resolve]);

  return {
    metadata,
    isLoading,
    isKnown: metadata.isKnown,
    refresh,
  };
}
