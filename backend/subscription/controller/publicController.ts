/**
 * GET /public/* – static public configuration (CDN-cacheable).
 */

import { ok } from '../../services/shared/apiResponse';
import { SURROGATE_KEY, scopedSurrogateKey } from '../../shared/cache/surrogateKeys';
import { publicDataStore } from '../store/publicDataStore';
import type { CacheableEndpointResult } from './types';

export interface PublicConfigEntry {
  key: string;
  value: unknown;
}

const PUBLIC_CONFIG: Record<string, unknown> = {
  'app/version': { minSupported: '1.0.0', latest: '1.0.0' },
  'app/support': { email: 'support@subtrackr.app', docsUrl: 'https://docs.subtrackr.app' },
  'billing/currencies': { supported: ['USD', 'EUR', 'GBP'] },
  'onboarding/steps': { count: 4, skippable: true },
};

function readPublicConfig(): Record<string, unknown> {
  return publicDataStore.listPublicConfig();
}

/** GET /public/:path* */
export function getPublicConfig(
  resourcePath: string,
  requestId?: string,
): CacheableEndpointResult<PublicConfigEntry | PublicConfigEntry[]> {
  const normalized = resourcePath.replace(/^\/+/, '').replace(/\/+$/, '');

  if (!normalized) {
    const entries = Object.entries(readPublicConfig()).map(([key, value]) => ({ key, value }));
    return {
      response: ok(entries, requestId),
      surrogateKeys: [SURROGATE_KEY.CONFIG],
    };
  }

  const config = readPublicConfig();
  const value = config[normalized];
  const entry: PublicConfigEntry = { key: normalized, value: value ?? null };

  return {
    response: ok(entry, requestId),
    surrogateKeys: [SURROGATE_KEY.CONFIG, scopedSurrogateKey(SURROGATE_KEY.CONFIG, normalized)],
  };
}
