/**
 * Hermetic test data.
 *
 * Every field is fixed — IDs, prices, dates — so seeding the same fixture twice
 * produces an identical app state. Dates are expressed as absolute ISO strings
 * relative to {@link FIXED_NOW_MS} (2024-01-15T12:00:00Z) rather than `Date.now()`
 * so they never drift between runs.
 */

/** Minimal, serializable subscription shape understood by the app's E2E seeder. */
export interface SeededSubscription {
  id: string;
  name: string;
  price: number;
  currency: string;
  billingCycle: 'monthly' | 'yearly' | 'weekly';
  category: string;
  nextBillingDate: string; // ISO 8601
  isActive: boolean;
}

/** A single, stable subscription used as the canonical "one item" fixture. */
export const NETFLIX_FIXTURE: SeededSubscription = {
  id: 'seed-netflix',
  name: 'Netflix',
  price: 15.49,
  currency: 'USD',
  billingCycle: 'monthly',
  category: 'streaming',
  nextBillingDate: '2024-02-01T00:00:00.000Z',
  isActive: true,
};

/** A small, deterministic portfolio for list / analytics screens. */
export const PORTFOLIO_FIXTURE: SeededSubscription[] = [
  NETFLIX_FIXTURE,
  {
    id: 'seed-spotify',
    name: 'Spotify',
    price: 9.99,
    currency: 'USD',
    billingCycle: 'monthly',
    category: 'streaming',
    nextBillingDate: '2024-01-20T00:00:00.000Z',
    isActive: true,
  },
  {
    id: 'seed-github',
    name: 'GitHub Pro',
    price: 48.0,
    currency: 'USD',
    billingCycle: 'yearly',
    category: 'software',
    nextBillingDate: '2024-06-01T00:00:00.000Z',
    isActive: true,
  },
];

/** Named fixtures so tests reference data by intent, not by literal arrays. */
export const fixtures = {
  empty: [] as SeededSubscription[],
  single: [NETFLIX_FIXTURE],
  portfolio: PORTFOLIO_FIXTURE,
} as const;

export type FixtureName = keyof typeof fixtures;
