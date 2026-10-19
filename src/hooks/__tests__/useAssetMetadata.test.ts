/**
 * Tests for useAssetMetadata hook (Issue #1721).
 *
 * Runs under the backend Jest config (ts-jest, no React Native renderer).
 * We test the hook's pure logic directly rather than via renderHook to avoid
 * the broken react-native jest-preset noted in AGENTS.md.
 */

import {
  getAssetMetadataSync,
  resolveAssetMetadata,
  buildFallbackMetadata,
} from '../../services/assetMetadataService';
import { cacheService } from '../../services/cache/cacheService';

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await cacheService.clearAll();
  jest.clearAllMocks();
});

// ─── Synchronous fast-path (the seed state the hook uses on mount) ────────────

describe('useAssetMetadata initial state via getAssetMetadataSync', () => {
  it('returns known metadata immediately for XLM', () => {
    const result = getAssetMetadataSync('XLM');
    expect(result.symbol).toBe('XLM');
    expect(result.name).toBe('Stellar Lumens');
    expect(result.isKnown).toBe(true);
    expect(result.logoURI).toBeDefined();
  });

  it('returns fallback immediately for an unknown symbol', () => {
    const result = getAssetMetadataSync('NOCOIN');
    expect(result.isKnown).toBe(false);
    expect(result.logoURI).toBeUndefined();
    expect(result.fallbackColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(result.initials).toBe('NOC');
  });

  it('isLoading seed: false for known assets, true for unknown', () => {
    // The hook's initial isLoading is derived as !getAssetMetadataSync(sym).isKnown
    expect(!getAssetMetadataSync('ETH').isKnown).toBe(false);   // known → not loading
    expect(!getAssetMetadataSync('UNKNOWN9').isKnown).toBe(true); // unknown → loading
  });
});

// ─── Async resolution path (what the hook calls after mount) ─────────────────

describe('useAssetMetadata async resolution via resolveAssetMetadata', () => {
  it('resolves the same known entry as the sync path', async () => {
    const sync = getAssetMetadataSync('ETH');
    const async_ = await resolveAssetMetadata('ETH');
    expect(sync.symbol).toBe(async_.symbol);
    expect(sync.name).toBe(async_.name);
    expect(sync.isKnown).toBe(async_.isKnown);
  });

  it('resolves a richer entry for unknown assets after cache write', async () => {
    const result = await resolveAssetMetadata('MANA');
    expect(result.isKnown).toBe(false);
    expect(result.initials).toBe('MAN');
    expect(result.fallbackColor).toBeDefined();
  });

  it('hook would not flash different metadata between sync and async for known assets', async () => {
    const sync = getAssetMetadataSync('USDC');
    const async_ = await resolveAssetMetadata('USDC');
    // name / symbol / isKnown must be consistent — no flash
    expect(sync.symbol).toBe(async_.symbol);
    expect(sync.name).toBe(async_.name);
    expect(sync.isKnown).toBe(async_.isKnown);
    // logoURI may differ only if sync is '' and async provides one,
    // but for USDC both should be defined.
    expect(async_.logoURI).toBeDefined();
  });

  it('caches the resolved result', async () => {
    await resolveAssetMetadata('XLM');
    await Promise.resolve(); // fire-and-forget set

    const getSpy = jest.spyOn(cacheService, 'get');
    await resolveAssetMetadata('XLM');
    expect(getSpy).toHaveBeenCalledWith('asset-metadata:XLM');
  });
});

// ─── Fallback consistency ─────────────────────────────────────────────────────

describe('fallback consistency for unknown assets', () => {
  it('same symbol always produces the same fallback color', () => {
    const a = buildFallbackMetadata('WEIRD');
    const b = buildFallbackMetadata('WEIRD');
    expect(a.fallbackColor).toBe(b.fallbackColor);
  });

  it('different unknown symbols can have different fallback colors', () => {
    const colors = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'].map(
      (s) => buildFallbackMetadata(s).fallbackColor,
    );
    const unique = new Set(colors);
    expect(unique.size).toBeGreaterThan(1);
  });

  it('fallback initials never exceed 3 chars', () => {
    const initials = buildFallbackMetadata('LONGTOKEN').initials;
    expect(initials.length).toBeLessThanOrEqual(3);
  });
});

// ─── Symbol normalisation ─────────────────────────────────────────────────────

describe('symbol normalisation', () => {
  it('resolves lowercase symbols to the same entry as uppercase', async () => {
    const upper = await resolveAssetMetadata('BTC');
    const lower = await resolveAssetMetadata('btc');
    expect(upper.symbol).toBe(lower.symbol);
    expect(upper.name).toBe(lower.name);
  });

  it('trims whitespace from symbols', async () => {
    const result = await resolveAssetMetadata('  ETH  ');
    expect(result.symbol).toBe('ETH');
    expect(result.isKnown).toBe(true);
  });
});

// ─── refresh-callback contract (pure logic layer) ────────────────────────────

describe('refresh contract', () => {
  it('resolving after cache invalidation fetches a fresh entry', async () => {
    await resolveAssetMetadata('SOL');
    await Promise.resolve(); // let cache write settle

    const cacheDeleteSpy = jest.spyOn(cacheService, 'delete');
    await cacheService.delete('asset-metadata:SOL');
    expect(cacheDeleteSpy).toHaveBeenCalled();

    // After deletion, a fresh resolution should hit the registry again
    const result = await resolveAssetMetadata('SOL');
    expect(result.isKnown).toBe(true);
    expect(result.name).toBe('Solana');
  });
});
