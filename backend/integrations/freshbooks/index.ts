/**
 * FreshBooks barrel.
 *
 * `SubTrackrInvoice` and `SubTrackrPayment` are deliberately **not** re-exported:
 * QuickBooks declares record types under the same names, so re-exporting both
 * from `backend/integrations/index.ts` would make those names ambiguous
 * (TS2308). Consumers that need the FreshBooks record shapes import them from
 * `FreshBooksSyncService` directly, or use the `FreshBooks*`-prefixed wire types
 * below.
 */
export { FreshBooksOAuthService } from './FreshBooksOAuthService';
export { FreshBooksSyncService } from './FreshBooksSyncService';
export { createFreshBooksRouter } from './freshbooksRouter';

export type {
  FreshBooksCredentials,
  FreshBooksTokenSet,
  FreshBooksOAuthState,
  FreshBooksAuthorization,
} from './FreshBooksOAuthService';

export type {
  // FreshBooks API wire shapes
  FreshBooksClient,
  FreshBooksInvoice,
  FreshBooksInvoiceLine,
  FreshBooksPayment,
  FreshBooksExpense,
  FreshBooksEstimate,
  FreshBooksEntityType,
  FreshBooksIdMapping,
  FreshBooksSyncOptions,
  FreshBooksSyncResult,
  FreshBooksFullSyncResult,
  SyncOutcome,
  DetailedSync,
} from './FreshBooksSyncService';

export type { FreshBooksRouterOptions } from './freshbooksRouter';
