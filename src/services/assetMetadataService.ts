/**
 * assetMetadataService – resolves display metadata (name, symbol, colour, icon URI)
 * for on-chain assets used throughout SubTrackr (Issue #1721).
 *
 * Architecture:
 *   1. KNOWN_ASSETS   – static compile-time registry for well-known assets
 *   2. CacheService   – two-layer cache (L1 in-memory + L2 AsyncStorage, 24-hour TTL)
 *   3. Fallback       – deterministic colour + initials for any unlisted asset
 *
 * The public entry-point is `resolveAssetMetadata(symbol)`.  It never throws –
 * unknown assets always receive a graceful fallback.
 */

import { cacheService } from './cache/cacheService';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Display metadata for a single asset / token. */
export interface AssetMetadata {
  /** Canonical ticker symbol, upper-cased (e.g. "XLM"). */
  symbol: string;
  /** Human-readable name (e.g. "Stellar Lumens"). */
  name: string;
  /**
   * Remote URL for the asset logo.
   * `undefined` when the asset is unknown — use `fallbackColor` + `initials`.
   */
  logoURI?: string;
  /** CSS hex colour used as background for the fallback icon. */
  fallbackColor: string;
  /** 1-3 character abbreviation for the text fallback (derived from `symbol`). */
  initials: string;
  /** True when this entry came from the static registry, false for dynamic/fallback. */
  isKnown: boolean;
}

// ─── Known-asset registry ─────────────────────────────────────────────────────

// Colors chosen to reflect each asset's visual identity and to meet WCAG AA
// contrast when rendered with white text.

const KNOWN_ASSETS: Record<string, Omit<AssetMetadata, 'initials' | 'isKnown'>> = {
  XLM: {
    symbol: 'XLM',
    name: 'Stellar Lumens',
    logoURI: 'https://assets.coingecko.com/coins/images/100/large/Stellar_symbol_black_RGB.png',
    fallbackColor: '#000000',
  },
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin',
    logoURI: 'https://assets.coingecko.com/coins/images/6319/large/USD_Coin_icon.png',
    fallbackColor: '#2775CA',
  },
  ETH: {
    symbol: 'ETH',
    name: 'Ethereum',
    logoURI: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
    fallbackColor: '#627EEA',
  },
  BTC: {
    symbol: 'BTC',
    name: 'Bitcoin',
    logoURI: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
    fallbackColor: '#F7931A',
  },
  MATIC: {
    symbol: 'MATIC',
    name: 'Polygon',
    logoURI: 'https://assets.coingecko.com/coins/images/4713/large/matic-token-icon.png',
    fallbackColor: '#8247E5',
  },
  ARB: {
    symbol: 'ARB',
    name: 'Arbitrum',
    logoURI: 'https://assets.coingecko.com/coins/images/16547/large/photo_2023-03-29_21.47.00.jpeg',
    fallbackColor: '#2D374B',
  },
  OP: {
    symbol: 'OP',
    name: 'Optimism',
    logoURI: 'https://assets.coingecko.com/coins/images/25244/large/Optimism.png',
    fallbackColor: '#FF0420',
  },
  SOL: {
    symbol: 'SOL',
    name: 'Solana',
    logoURI: 'https://assets.coingecko.com/coins/images/4128/large/solana.png',
    fallbackColor: '#9945FF',
  },
  AVAX: {
    symbol: 'AVAX',
    name: 'Avalanche',
    logoURI: 'https://assets.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png',
    fallbackColor: '#E84142',
  },
  BNB: {
    symbol: 'BNB',
    name: 'BNB',
    logoURI: 'https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png',
    fallbackColor: '#F3BA2F',
  },
  LINK: {
    symbol: 'LINK',
    name: 'Chainlink',
    logoURI: 'https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png',
    fallbackColor: '#375BD2',
  },
  UNI: {
    symbol: 'UNI',
    name: 'Uniswap',
    logoURI: 'https://assets.coingecko.com/coins/images/12504/large/uniswap-uni.png',
    fallbackColor: '#FF007A',
  },
  DAI: {
    symbol: 'DAI',
    name: 'Dai',
    logoURI: 'https://assets.coingecko.com/coins/images/9956/large/4943.png',
    fallbackColor: '#F5AC37',
  },
  WBTC: {
    symbol: 'WBTC',
    name: 'Wrapped Bitcoin',
    logoURI: 'https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png',
    fallbackColor: '#F7931A',
  },
  ATOM: {
    symbol: 'ATOM',
    name: 'Cosmos',
    logoURI: 'https://assets.coingecko.com/coins/images/1481/large/cosmos_hub.png',
    fallbackColor: '#2E3148',
  },
  DOT: {
    symbol: 'DOT',
    name: 'Polkadot',
    logoURI: 'https://assets.coingecko.com/coins/images/12171/large/polkadot.png',
    fallbackColor: '#E6007A',
  },
  ADA: {
    symbol: 'ADA',
    name: 'Cardano',
    logoURI: 'https://assets.coingecko.com/coins/images/975/large/cardano.png',
    fallbackColor: '#0D1E2D',
  },
  LTC: {
    symbol: 'LTC',
    name: 'Litecoin',
    logoURI: 'https://assets.coingecko.com/coins/images/2/large/litecoin.png',
    fallbackColor: '#345D9D',
  },
};

/** How long resolved metadata is held in cache (24 hours). */
export const ASSET_METADATA_TTL_MS = 24 * 60 * 60 * 1000;

/** Cache key prefix to allow tag-based bulk invalidation. */
export const CACHE_TAG = 'asset-metadata';

// ─── Fallback palette ─────────────────────────────────────────────────────────

// A fixed palette of accessible colours cycled deterministically for unknown
// assets, guaranteeing a visually distinct (non-grey) background regardless of
// which symbol is requested.

const FALLBACK_COLORS = [
  '#5B6EF5', // indigo
  '#3DBDAF', // teal
  '#E8693A', // terracotta
  '#D14D9D', // magenta
  '#7CB342', // green
  '#F5A623', // amber
  '#1E88E5', // blue
  '#6D4C41', // brown
];

/**
 * Deterministic colour picker: hash the symbol to a palette index.
 * Pure function — same symbol always returns the same colour.
 */
export function pickFallbackColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0; // keep unsigned
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]!;
}

/**
 * Derives initials from a symbol.
 * Up to 3 characters, upper-cased.
 * Examples: "XLM" → "XLM", "WBTC" → "WBT", "usdc" → "USD"
 */
export function deriveInitials(symbol: string): string {
  return symbol.trim().toUpperCase().slice(0, 3);
}

// ─── Core resolver ────────────────────────────────────────────────────────────

/**
 * Build a complete `AssetMetadata` record for an unknown symbol.
 * Always succeeds — never throws.
 */
export function buildFallbackMetadata(rawSymbol: string): AssetMetadata {
  const symbol = rawSymbol.trim().toUpperCase() || '?';
  return {
    symbol,
    name: symbol,
    logoURI: undefined,
    fallbackColor: pickFallbackColor(symbol),
    initials: deriveInitials(symbol),
    isKnown: false,
  };
}

/**
 * Resolve display metadata for an asset symbol.
 *
 * Resolution order:
 *   1. CacheService (L1 memory → L2 AsyncStorage)
 *   2. KNOWN_ASSETS static registry
 *   3. Graceful fallback (deterministic colour + initials)
 *
 * The result is written back into cache so subsequent calls for the same
 * symbol are served at memory speed.
 *
 * @param symbol - Ticker symbol (case-insensitive, e.g. "xlm", "USDC")
 */
export async function resolveAssetMetadata(symbol: string): Promise<AssetMetadata> {
  const normalised = symbol.trim().toUpperCase();
  if (!normalised) return buildFallbackMetadata(symbol);

  const cacheKey = `asset-metadata:${normalised}`;

  // 1. Cache hit
  const cached = await cacheService.get<AssetMetadata>(cacheKey);
  if (cached) return cached;

  // 2. Static registry
  const known = KNOWN_ASSETS[normalised];
  let metadata: AssetMetadata;

  if (known) {
    metadata = {
      ...known,
      initials: deriveInitials(normalised),
      isKnown: true,
    };
  } else {
    // 3. Fallback
    metadata = buildFallbackMetadata(normalised);
  }

  // Write to cache (fire-and-forget – resolution is always synchronous above)
  cacheService
    .set(cacheKey, metadata, {
      ttl: ASSET_METADATA_TTL_MS,
      tags: [CACHE_TAG],
    })
    .catch(() => {
      // cache write failure is non-fatal
    });

  return metadata;
}

/**
 * Bulk-resolve metadata for multiple symbols in one call.
 * Returns results in the same order as the input array.
 */
export async function resolveMultipleAssets(symbols: string[]): Promise<AssetMetadata[]> {
  return Promise.all(symbols.map((s) => resolveAssetMetadata(s)));
}

/**
 * Synchronous fast-path: returns the known-asset entry if available,
 * otherwise returns the fallback.  Does **not** consult the async cache –
 * use `resolveAssetMetadata` when you need the full async path.
 */
export function getAssetMetadataSync(symbol: string): AssetMetadata {
  const normalised = symbol.trim().toUpperCase();
  const known = KNOWN_ASSETS[normalised];
  if (known) {
    return { ...known, initials: deriveInitials(normalised), isKnown: true };
  }
  return buildFallbackMetadata(normalised);
}

/**
 * Expose the registry for consumers that need to enumerate known assets
 * (e.g. auto-complete, analytics).
 */
export function getKnownAssets(): AssetMetadata[] {
  return Object.values(KNOWN_ASSETS).map((a) => ({
    ...a,
    initials: deriveInitials(a.symbol),
    isKnown: true,
  }));
}

/**
 * Invalidate cached metadata for a specific symbol.
 * Useful when an external source provides a new logoURI.
 */
export async function invalidateAssetMetadata(symbol: string): Promise<void> {
  const cacheKey = `asset-metadata:${symbol.trim().toUpperCase()}`;
  await cacheService.delete(cacheKey);
}

/**
 * Invalidate all cached asset metadata entries (tag-based bulk clear).
 */
export async function invalidateAllAssetMetadata(): Promise<void> {
  await cacheService.invalidateByTag(CACHE_TAG);
}
