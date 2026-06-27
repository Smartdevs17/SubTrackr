/**
 * @deprecated Use \`useStore\` from \`./combinedStore\` instead.
 * All stores are now combined into a single store using the slices pattern.
 */
export { useStore as useCancellationStore } from './combinedStore';

export const CANCELLATION_REASONS = [
  'Too Expensive',
  'Switching to Competitor',
  'Technical Issues',
  'Missing Features',
  'Not Using It',
  'Other',
] as const;

export type CancellationReason = (typeof CANCELLATION_REASONS)[number];
export type CancellationStep = 'REASON' | 'OFFERS' | 'CONFIRM' | 'SUCCESS';
