/**
 * CDN surrogate key resource types for granular edge-cache purging.
 *
 * Each cacheable response includes one or more of these keys in the
 * Surrogate-Key response header so the CDN can purge by resource type.
 */
export const SURROGATE_KEY = {
  PLAN: 'plan',
  PRICING: 'pricing',
  FEATURE: 'feature',
  CONFIG: 'config',
  USER: 'user',
} as const;

export type SurrogateKeyType = (typeof SURROGATE_KEY)[keyof typeof SURROGATE_KEY];

/** Build a resource-scoped surrogate key, e.g. `plan:pro-monthly`. */
export function scopedSurrogateKey(type: SurrogateKeyType, id: string): string {
  return `${type}:${id}`;
}

/** Format multiple keys for the Surrogate-Key response header. */
export function formatSurrogateKeyHeader(keys: string[]): string {
  return [...new Set(keys.filter(Boolean))].join(' ');
}
