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

/**
 * The full combined store state — every slice spread together.
 */
export interface AppState
  extends AuthSlice, UserSlice, SettingsSlice, NetworkSlice, TransactionSlice, SearchSlice {}

/**
 * SliceCreator with full cross-slice access: the 4th generic is AppState so a
 * slice may read/write other slices (e.g. user slice reading auth slice).
 */
export type SliceCreator<T> = StateCreator<T, [], [], AppState>;
