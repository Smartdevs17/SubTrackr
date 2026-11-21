/**
 * backend/src/sla/errors.ts
 */

export type SlaErrorCode =
  | 'invalid_policy'
  | 'unknown_tier'
  | 'unknown_subscription'
  | 'duplicate_subscription'
  | 'invalid_input'
  | 'unknown_incident'
  | 'period_open';

export class SlaError extends Error {
  constructor(
    readonly code: SlaErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'SlaError';
  }
}
