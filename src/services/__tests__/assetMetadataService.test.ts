/**
 * Tests for assetMetadataService (Issue #1721).
 *
 * Covers:
 *   - Known-asset registry lookup (case-insensitive)
 *   - Fallback metadata for unknown symbols
 *   - Cache read/write/invalidation
 *   - deriveInitials + pickFallbackColor determinism
 *   - resolveMultipleAssets, getAssetMetadataSync, getKnownAssets
 */

import {
  resolveAssetMetadata,
  resolveMultipleAssets,
  getAssetMetadataSync,
  getKnownAssets,
  buildFallbackMetadata,
  pickFallbackColor,
  deriveInitials,
  invalidateAssetMetadata,
  invalidateAllAssetMetadata,
  ASSET_METADATA_TTL_MS,
  CACHE_TAG,
} from '../assetMetadataService';
import { cacheService } from '../cache/cacheService';

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  // Wipe the cache between tests so results don't bleed across.
  await cacheService.clearAll();
  jest.clearAllMocks();
});

// ─── deriveInitials ───────────────────────────────────────────────────────────

describe('deriveInitials', () => {
  it('returns symbol upper-cased, up to 3 chars', () => {
    expect(deriveInitials('xlm')).toBe('XLM');
    expect(deriveInitials('USDC')).toBe('USD');
    expect(deriveInitials('BTC')).toBe('BTC');
  });

  it('handles short symbols', () => {
    expect(deriveInitials('X')).toBe('X');
    expect(deriveInitials('AB')).toBe('AB');
  });

  it('trims whitespace', () => {
    expect(deriveInitials('  ETH  ')).toBe('ETH');
  });
});

// ─── pickFallbackColor ────────────────────────────────────────────────────────

describe('pickFallbackColor', () => {
  it('returns a hex colour string', () => {
    const color = pickFallbackColor('UNKNOWN');
    expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('is deterministic — same input gives same output', () => {
    expect(pickFallbackColor('MANA')).toBe(pickFallbackColor('MANA'));
  });

  it('produces different colours for different symbols', () => {
    // Not guaranteed by the algorithm but true in practice for these symbols
    const colors = ['MANA', 'ZRX', 'SUSHI', 'CAKE', 'SPELL'].map(pickFallbackColor);
    const unique = new Set(colors);
    expect(unique.size).toBeGreaterThan(1);
  });
});

// ─── buildFallbackMetadata ────────────────────────────────────────────────────

describe('buildFallbackMetadata', () => {
  it('sets isKnown=false', () => {
    expect(buildFallbackMetadata('UNKNOWN').isKnown).toBe(false);
  });

  it('upper-cases the symbol', () => {
    expect(buildFallbackMetadata('mana').symbol).toBe('MANA');
  });

  it('uses the symbol as name', () => {
    expect(buildFallbackMetadata('ZZZZZ').name).toBe('ZZZZZ');
  });

  it('does not set a logoURI', () => {
    expect(buildFallbackMetadata('UNKNOWN').logoURI).toBeUndefined();
  });

  it('derives initials correctly', () => {
    expect(buildFallbackMetadata('ABCDE').initials).toBe('ABC');
  });

  it('handles empty symbol gracefully', () => {
    const result = buildFallbackMetadata('');
    expect(result.symbol).toBe('?');
    expect(result.initials).toBe('?');
  });
});

// ─── getAssetMetadataSync ─────────────────────────────────────────────────────

describe('getAssetMetadataSync', () => {
  it('returns known metadata for XLM', () => {
    const result = getAssetMetadataSync('XLM');
    expect(result.name).toBe('Stellar Lumens');
    expect(result.isKnown).toBe(true);
    expect(result.logoURI).toBeDefined();
  });

  it('is case-insensitive', () => {
    const result = getAssetMetadataSync('xlm');
    expect(result.symbol).toBe('XLM');
    expect(result.isKnown).toBe(true);
  });

  it('returns fallback for unknown symbol', () => {
    const result = getAssetMetadataSync('FOOBAR');
    expect(result.isKnown).toBe(false);
    expect(result.logoURI).toBeUndefined();
  });

  it('returns fallback for ETH', () => {
    const eth = getAssetMetadataSync('ETH');
    expect(eth.name).toBe('Ethereum');
  });
});

// ─── resolveAssetMetadata ─────────────────────────────────────────────────────

describe('resolveAssetMetadata', () => {
  it('resolves known asset USDC', async () => {
    const result = await resolveAssetMetadata('USDC');
    expect(result.name).toBe('USD Coin');
    expect(result.isKnown).toBe(true);
    expect(result.logoURI).toContain('coingecko');
    expect(result.initials).toBe('USD');
  });

  it('is case-insensitive for lookup', async () => {
    const lower = await resolveAssetMetadata('xlm');
    expect(lower.symbol).toBe('XLM');
    expect(lower.isKnown).toBe(true);
  });

  it('returns fallback for unknown symbol', async () => {
    const result = await resolveAssetMetadata('UNKNOWN_TOKEN_99');
    expect(result.isKnown).toBe(false);
    expect(result.logoURI).toBeUndefined();
    expect(result.fallbackColor).toMatch(/^#/);
  });

  it('writes result to cache after first resolution', async () => {
    const setSpy = jest.spyOn(cacheService, 'set');
    await resolveAssetMetadata('ETH');
    // The set call is fire-and-forget; give it a tick to settle
    await Promise.resolve();
    expect(setSpy).toHaveBeenCalledWith(
      'asset-metadata:ETH',
      expect.objectContaining({ symbol: 'ETH' }),
      expect.objectContaining({ ttl: ASSET_METADATA_TTL_MS, tags: [CACHE_TAG] }),
    );
  });

  it('reads from cache on the second call (cache hit)', async () => {
    const getSpy = jest.spyOn(cacheService, 'get');
    await resolveAssetMetadata('BTC');
    // Let the fire-and-forget set complete
    await Promise.resolve();
    getSpy.mockClear();

    await resolveAssetMetadata('BTC');
    expect(getSpy).toHaveBeenCalledWith('asset-metadata:BTC');
    // Second call should return the cached result without hitting static registry again
    const result = await resolveAssetMetadata('BTC');
    expect(result.name).toBe('Bitcoin');
  });

  it('handles empty string gracefully', async () => {
    const result = await resolveAssetMetadata('');
    expect(result.isKnown).toBe(false);
    expect(result.symbol).toBe('?');
  });

  it('resolves MATIC correctly', async () => {
    const result = await resolveAssetMetadata('MATIC');
    expect(result.name).toBe('Polygon');
    expect(result.fallbackColor).toBe('#8247E5');
  });
});

// ─── resolveMultipleAssets ────────────────────────────────────────────────────

describe('resolveMultipleAssets', () => {
  it('returns results in the same order as input', async () => {
    const symbols = ['XLM', 'ETH', 'USDC'];
    const results = await resolveMultipleAssets(symbols);
    expect(results).toHaveLength(3);
    expect(results[0]!.symbol).toBe('XLM');
    expect(results[1]!.symbol).toBe('ETH');
    expect(results[2]!.symbol).toBe('USDC');
  });

  it('mixes known and unknown assets', async () => {
    const results = await resolveMultipleAssets(['XLM', 'FAKECOIN']);
    expect(results[0]!.isKnown).toBe(true);
    expect(results[1]!.isKnown).toBe(false);
  });

  it('handles an empty array', async () => {
    const results = await resolveMultipleAssets([]);
    expect(results).toEqual([]);
  });
});

// ─── getKnownAssets ───────────────────────────────────────────────────────────

describe('getKnownAssets', () => {
  it('returns a non-empty list', () => {
    const assets = getKnownAssets();
    expect(assets.length).toBeGreaterThan(0);
  });

  it('every entry is marked isKnown=true', () => {
    const assets = getKnownAssets();
    expect(assets.every((a) => a.isKnown)).toBe(true);
  });

  it('includes XLM, ETH, USDC, BTC', () => {
    const symbols = getKnownAssets().map((a) => a.symbol);
    expect(symbols).toContain('XLM');
    expect(symbols).toContain('ETH');
    expect(symbols).toContain('USDC');
    expect(symbols).toContain('BTC');
  });

  it('every entry has initials of 1-3 chars', () => {
    const assets = getKnownAssets();
    for (const asset of assets) {
      expect(asset.initials.length).toBeGreaterThanOrEqual(1);
      expect(asset.initials.length).toBeLessThanOrEqual(3);
    }
  });
});

// ─── Cache invalidation ───────────────────────────────────────────────────────

describe('invalidateAssetMetadata', () => {
  it('removes the specific symbol from cache', async () => {
    await resolveAssetMetadata('XLM');
    await Promise.resolve(); // let fire-and-forget set settle

    await invalidateAssetMetadata('XLM');

    const deleteSpy = jest.spyOn(cacheService, 'delete');
    await invalidateAssetMetadata('XLM');
    expect(deleteSpy).toHaveBeenCalledWith('asset-metadata:XLM');
  });
});

describe('invalidateAllAssetMetadata', () => {
  it('calls invalidateByTag with the correct tag', async () => {
    const tagSpy = jest.spyOn(cacheService, 'invalidateByTag');
    await invalidateAllAssetMetadata();
    expect(tagSpy).toHaveBeenCalledWith(CACHE_TAG);
  });
});
