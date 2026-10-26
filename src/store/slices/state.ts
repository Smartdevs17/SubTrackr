/**
 * state.ts — Combined app state type used by every slice creator.
 *
 * Importing this from slices avoids circular type imports: the creators import
 * AppState here, and index.ts composes the creators into the root store.
 */

import { StateCreator } from 'zustand';
import { AuthSlice } from './authSlice';
import { UserSlice } from './userSlice';
import { SettingsSlice } from './settingsSlice';
import { NetworkSlice } from './networkSlice';
import { TransactionSlice } from './transactionSlice';
import { SearchSlice } from './searchSlice';
import { CreditSlice } from './creditSlice';
import { MeteringSlice } from './meteringSlice';
import { PaymentSlice } from './paymentSlice';
import { BatchSlice } from './batchSlice';
import { AnalyticsSlice } from './analyticsSlice';

/**
 * The full combined store state — every slice spread together.
 */
export interface AppState
  extends
    AuthSlice,
    UserSlice,
    SettingsSlice,
    NetworkSlice,
    TransactionSlice,
    SearchSlice,
    CreditSlice,
    MeteringSlice,
    PaymentSlice,
    BatchSlice,
    AnalyticsSlice {}

/**
 * SliceCreator with full cross-slice access: the 4th generic is AppState so a
 * slice may read/write other slices (e.g. user slice reading auth slice).
 */
export type SliceCreator<T> = StateCreator<T, [], [], AppState>;
