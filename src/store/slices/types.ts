/**
 * Combined state type union for all Zustand store slices.
 * Each slice interface is defined in its own file and re-exported here.
 *
 * The slices pattern follows Zustand's recommended approach:
 * https://docs.pmnd.rs/zustand/guides/slices-pattern
 */

import type { SubscriptionSlice } from './billingSlice';
import type { InvoiceSlice } from './billingSlice';
import type { TaxSlice } from './billingSlice';
import type { UsageSlice } from './billingSlice';
import type { AccountingSlice } from './billingSlice';
import type { CancellationSlice } from './billingSlice';

import type { WalletSlice } from './walletSlice';
import type { TransactionQueueSlice } from './walletSlice';
import type { MerchantSlice } from './walletSlice';

import type { SettingsSlice } from './settingsSlice';
import type { UserSlice } from './settingsSlice';
import type { CommunitySlice } from './settingsSlice';

import type { WebhookSlice } from './engagementSlice';
import type { GamificationSlice } from './engagementSlice';
import type { LoyaltySlice } from './engagementSlice';
import type { AffiliateSlice } from './engagementSlice';

import type { FraudSlice } from './riskSlice';
import type { SlaSlice } from './riskSlice';

import type { SandboxSlice } from './devSlice';
import type { DeveloperPortalSlice } from './devSlice';

import type { CampaignSlice } from './marketingSlice';
import type { SegmentSlice } from './marketingSlice';
import type { GroupSlice } from './marketingSlice';

import type { CalendarSlice } from './calendarSlice';
import type { NetworkSlice } from './networkSlice';
import type { SupportSlice } from './supportSlice';

import type { MeteringSlice } from './meteringSlice';
import type { CreditSlice } from './meteringSlice';
import type { BatchSlice } from './meteringSlice';
import type { SearchSlice } from './meteringSlice';

/**
 * Combined state combining all slices.
 * This is the root type for the unified Zustand store.
 */
export type AppState = SubscriptionSlice &
  InvoiceSlice &
  TaxSlice &
  UsageSlice &
  AccountingSlice &
  CancellationSlice &
  WalletSlice &
  TransactionQueueSlice &
  MerchantSlice &
  SettingsSlice &
  UserSlice &
  CommunitySlice &
  WebhookSlice &
  GamificationSlice &
  LoyaltySlice &
  AffiliateSlice &
  FraudSlice &
  SlaSlice &
  SandboxSlice &
  DeveloperPortalSlice &
  CampaignSlice &
  SegmentSlice &
  GroupSlice &
  CalendarSlice &
  NetworkSlice &
  SupportSlice &
  MeteringSlice &
  CreditSlice &
  BatchSlice &
  SearchSlice;
