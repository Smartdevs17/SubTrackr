/**
 * GET /features – public feature flags and gating config (CDN-cacheable).
 */

import { ok } from '../../services/shared/apiResponse';
import { backendFeatureFlagsService } from '../../services/featureFlags';
import { SURROGATE_KEY } from '../../shared/cache/surrogateKeys';
import { publicDataStore } from '../store/publicDataStore';
import type { CacheableEndpointResult } from './types';

export interface PublicFeatureSummary {
  id: string;
  name: string;
  enabled: boolean;
  tierAccess: string[];
}

export interface FeaturesDataProvider {
  listPublicFeatures(): PublicFeatureSummary[];
}

const storeFeaturesProvider: FeaturesDataProvider = {
  listPublicFeatures(): PublicFeatureSummary[] {
    const features = backendFeatureFlagsService.getAllFeatures();
    return Object.entries(features).map(([id, feature]) => {
      const override = publicDataStore.getFeatureOverride(id);
      return {
        id,
        name: feature.name,
        enabled: override !== undefined ? override : feature.enabled,
        tierAccess: feature.tierAccess,
      };
    });
  },
};

/** GET /features */
export function getFeatures(
  provider: FeaturesDataProvider = storeFeaturesProvider,
  requestId?: string,
): CacheableEndpointResult<PublicFeatureSummary[]> {
  const features = provider.listPublicFeatures();

  return {
    response: ok(features, requestId),
    surrogateKeys: [SURROGATE_KEY.FEATURE],
  };
}
